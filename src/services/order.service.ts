import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { orderItems, orders, products, coupons, notifications } from "../db/schema.js";
import { AppError, NotFoundError } from "../lib/http.js";
import { validateCoupon } from "./coupon.service.js";
import { createPaymentIntent, PaymentProviderResult } from "./payment.service.js";
import { sendOrderConfirmation } from "./email.service.js";

export const TAX_RATE = 0.15;

export interface CartLine {
  productId: number;
  qty: number;
}

export interface Totals {
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  couponCode?: string;
  couponDiscount: number;
}

/**
 * Pure function: compute order totals from line totals and an optional discount fraction.
 * Kept separate from DB so it can be unit-tested without a database.
 */
export function computeTotals(subtotal: number, couponDiscount: number, couponCode?: string): Totals {
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const discount = Math.min(Math.round(couponDiscount * 100) / 100, subtotal);
  const total = Math.round((subtotal + tax - discount) * 100) / 100;
  return { subtotal, tax, discount, total, couponCode, couponDiscount };
}

/**
 * Compute the fractional discount a coupon applies to a subtotal.
 */
export function applyCouponToSubtotal(subtotal: number, discountFraction: number): number {
  return subtotal * discountFraction;
}

export interface CreateOrderInput {
  items: CartLine[];
  couponCode?: string;
  shipping: { name: string; email: string; address: string; city: string; phone: string };
  paymentMethod: "card" | "momo" | "instacash";
  userId?: string;
  isGuest: boolean;
  paymentNumber?: string;
}

export interface CreateOrderResult {
  order: OrderPayload;
  payment: PaymentProviderResult | null;
}

export interface OrderPayload {
  id: string;
  userId: string | null;
  isGuest: boolean;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  couponCode: string | null;
  shipping: CreateOrderInput["shipping"] | null;
  items: Array<{ productId: number; name: string; price: number; qty: number }>;
  createdAt: Date;
}

function generateOrderId(): string {
  return "ORD-" + randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Creates an order atomically:
 *  1. Validates all products exist and have sufficient stock (row locks held until commit).
 *  2. Recomputes totals server-side (never trusts the client).
 *  3. Decrements stock and records order + line items in a single transaction.
 *  4. Attempts payment capture (real Stripe PaymentIntent for card, MTN MoMo Collection
 *     request-to-pay for MoMo, configurable gateway adapter for InstaCash).
 *  5. Enqueues a confirmation email + in-app notification.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.items.length) throw new AppError(400, "Cart is empty.", "EMPTY_CART");

  const orderId = generateOrderId();
  const shippingEmail = (input.shipping.email || input.userId || "").toLowerCase();

  // -- Validate & lock stock --
  const lockedProducts: Array<{ id: number; name: string; price: number; img: string | null; stock: number; qty: number }> = [];
  for (const line of input.items) {
    if (!line.productId || line.qty < 1) throw new AppError(400, "Invalid cart line.", "INVALID_LINE");
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.id, line.productId))
      .for("update");
    if (!row) throw new NotFoundError("Product");
    if (row.stock < line.qty) {
      throw new AppError(409, `Insufficient stock for ${row.name}. Available: ${row.stock}`, "INSUFFICIENT_STOCK");
    }
    lockedProducts.push({ id: row.id, name: row.name, price: Number(row.price), img: row.img, stock: row.stock, qty: line.qty });
  }

  // -- Coupon validation & discount --
  let discountFraction = 0;
  let couponCode: string | undefined;
  if (input.couponCode) {
    const coupon = await validateCoupon(input.couponCode);
    discountFraction = coupon.discount;
    couponCode = coupon.code;
  }

  const subtotal = Math.round(lockedProducts.reduce((acc, p) => acc + p.price * p.qty, 0) * 100) / 100;
  const totals = computeTotals(subtotal, applyCouponToSubtotal(subtotal, discountFraction), couponCode);

  // -- Persist in a transaction --
  const result = await db.transaction(async (tx) => {
    // Re-lock and decrement stock within the transaction for atomicity.
    for (const line of input.items) {
      const [row] = await tx.select().from(products).where(eq(products.id, line.productId)).for("update");
      if (!row) throw new NotFoundError("Product");
      if (row.stock < line.qty) {
        throw new AppError(409, `Insufficient stock for ${row.name}. Available: ${row.stock}`, "INSUFFICIENT_STOCK");
      }
      await tx
        .update(products)
        .set({ stock: row.stock - line.qty, updatedAt: new Date() })
        .where(eq(products.id, line.productId));
    }

    if (couponCode) {
      await tx
        .update(coupons)
        .set({ uses: sql`${coupons.uses} + 1` })
        .where(eq(coupons.code, couponCode));
    }

    const now = new Date();
    const [order] = await tx
      .insert(orders)
      .values({
        id: orderId,
        userId: input.userId ?? null,
        isGuest: input.isGuest,
        status: "Processing",
        paymentMethod: input.paymentMethod,
        paymentStatus: "pending",
        subtotal: totals.subtotal.toFixed(2),
        tax: totals.tax.toFixed(2),
        discount: totals.discount.toFixed(2),
        total: totals.total.toFixed(2),
        couponCode: couponCode ?? null,
        shipping: input.shipping
      })
      .returning();

    for (const line of input.items) {
      const p = lockedProducts.find((x) => x.id === line.productId)!;
      await tx.insert(orderItems).values({
        orderId,
        productId: p.id,
        name: p.name,
        price: p.price.toFixed(2),
        img: p.img,
        qty: line.qty
      });
    }

    return { order, now };
  });

  // -- Payment capture --
  let payment: PaymentProviderResult | null = null;
  try {
    payment = await createPaymentIntent({
      method: input.paymentMethod,
      amount: totals.total,
      orderId,
      currency: "szl",
      email: shippingEmail,
      paymentNumber: input.paymentNumber
    });
    if (payment && payment.paymentIntentId) {
      await db
        .update(orders)
        .set({ paymentIntentId: payment.paymentIntentId, paymentStatus: payment.status ?? "pending" })
        .where(eq(orders.id, orderId));
    }
  } catch {
    // Payment failure should not silently lose the order; mark as failed and surface.
    await db.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, orderId));
    throw new AppError(502, "Payment could not be processed. Your order was not completed.", "PAYMENT_FAILED");
  }

  // -- Post-order side effects (fire-and-forget, non-blocking) --
  const payload: OrderPayload = {
    id: result.order.id,
    userId: result.order.userId,
    isGuest: result.order.isGuest,
    status: result.order.status,
    paymentMethod: result.order.paymentMethod ?? "",
    paymentStatus: result.order.paymentStatus ?? "pending",
    subtotal: totals.subtotal,
    tax: totals.tax,
    discount: totals.discount,
    total: totals.total,
    couponCode: couponCode ?? null,
    shipping: input.shipping,
    items: input.items.map((l) => {
      const p = lockedProducts.find((x) => x.id === l.productId)!;
      return { productId: p.id, name: p.name, price: p.price, qty: l.qty };
    }),
    createdAt: result.now
  };

  void sendOrderConfirmation(shippingEmail, payload).catch(() => undefined);

  // In-app notification for signed-in users (mirrors the old client-side notify()).
  if (input.userId) {
    void db
      .insert(notifications)
      .values({
        userId: input.userId,
        title: "Order Confirmed",
        msg: `Order #${orderId.substring(0, 8)} received. Total: E${totals.total.toFixed(2)}`
      })
      .catch(() => undefined);
  }

  return { order: payload, payment };
}

export async function getOrderById(id: string): Promise<OrderPayload | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  return {
    id: order.id,
    userId: order.userId,
    isGuest: order.isGuest,
    status: order.status,
    paymentMethod: order.paymentMethod ?? "",
    paymentStatus: order.paymentStatus ?? "pending",
    subtotal: Number(order.subtotal),
    tax: Number(order.tax),
    discount: Number(order.discount),
    total: Number(order.total),
    couponCode: order.couponCode,
    shipping: order.shipping ?? null,
    items: items.map((i) => ({ productId: i.productId, name: i.name, price: Number(i.price), qty: i.qty })),
    createdAt: order.createdAt
  };
}

export async function listOrdersForUser(userId: string): Promise<OrderPayload[]> {
  const rows = await db.select().from(orders).where(eq(orders.userId, userId)).orderBy(orders.createdAt);
  return Promise.all(rows.map(async (o) => (await getOrderById(o.id))!));
}

export async function listAllOrders(): Promise<OrderPayload[]> {
  const rows = await db.select().from(orders).orderBy(orders.createdAt);
  return Promise.all(rows.map(async (o) => (await getOrderById(o.id))!));
}

export async function updateOrderStatus(id: string, status: string): Promise<OrderPayload> {
  const allowed = ["Processing", "Shipped", "Delivered", "Cancelled"];
  if (!allowed.includes(status)) throw new AppError(400, "Invalid order status.", "INVALID_STATUS");
  const existing = await getOrderById(id);
  if (!existing) throw new NotFoundError("Order");
  await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id));
  return { ...existing, status };
}

export function isOrderOwner(order: OrderPayload, email: string | undefined): boolean {
  return !order.isGuest && order.userId === email;
}

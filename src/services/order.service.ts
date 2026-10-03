import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { orderItems, orders, products, coupons, notifications } from "../db/schema.js";
import { AppError, NotFoundError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
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
 * Compute a cart subtotal from priced lines. Kept separate from DB so quantity
 * handling can be unit-tested without a database.
 */
export function computeSubtotal(lines: Array<{ price: number; qty: number }>): number {
  return Math.round(lines.reduce((acc, line) => acc + line.price * line.qty, 0) * 100) / 100;
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
 * Creates an order as a pending payment reservation:
 *  1. Validates products without holding row locks outside a transaction.
 *  2. Recomputes quantity-aware totals server-side (never trusts the client).
 *  3. Atomically locks products, decrements stock, claims coupon use, and records
 *     the order plus line items in a single transaction.
 *  4. Attempts payment initiation outside the transaction.
 *  5. Releases the reservation if payment initiation fails, so inventory and coupon
 *     use are not permanently consumed by an unpaid order.
 *  6. Enqueues a confirmation email + in-app notification.
 */
/**
 * Merge duplicate product lines by summing quantities, so stock checks see the
 * true combined quantity. Pure — unit-testable without a database.
 */
export function mergeCartLines(lines: Array<{ productId: number; qty: number }>): Array<{
  productId: number;
  qty: number;
}> {
  const merged = new Map<number, number>();
  for (const line of lines) {
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.items.length) throw new AppError(400, "Cart is empty.", "EMPTY_CART");

  const orderId = generateOrderId();
  const shippingEmail = (input.shipping.email || input.userId || "").toLowerCase();
  const normalizedCouponCode = input.couponCode?.trim().toUpperCase();

  // Duplicate lines for the same product must not each pass a stock check
  // their combined quantity fails — merge first, then validate.
  const items = mergeCartLines(input.items);

  // -- Validate products without holding row locks outside the transaction --
  const lockedProducts: Array<{
    id: number;
    name: string;
    price: number;
    img: string | null;
    stock: number;
    qty: number;
  }> = [];
  for (const line of items) {
    if (!line.productId || !Number.isInteger(line.qty) || line.qty < 1) {
      throw new AppError(400, "Invalid cart line.", "INVALID_LINE");
    }
    const [row] = await db.select().from(products).where(eq(products.id, line.productId));
    if (!row) throw new NotFoundError("Product");
    if (row.stock < line.qty) {
      throw new AppError(409, `Insufficient stock for ${row.name}. Available: ${row.stock}`, "INSUFFICIENT_STOCK");
    }
    lockedProducts.push({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      img: row.img,
      stock: row.stock,
      qty: line.qty
    });
  }

  // -- Persist the reservation in a transaction --
  const result = await db.transaction(async (tx) => {
    // Lock and decrement stock within the transaction for atomicity.
    for (const line of items) {
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

    let discountFraction = 0;
    let couponCode: string | undefined;
    if (normalizedCouponCode) {
      const [claimedCoupon] = await tx
        .update(coupons)
        .set({ uses: sql`${coupons.uses} + 1` })
        .where(
          and(
            eq(coupons.code, normalizedCouponCode),
            eq(coupons.active, true),
            or(isNull(coupons.expiresAt), gt(coupons.expiresAt, new Date())),
            or(isNull(coupons.maxUses), sql`${coupons.uses} < ${coupons.maxUses}`)
          )
        )
        .returning();
      if (!claimedCoupon) {
        const [existingCoupon] = await tx.select().from(coupons).where(eq(coupons.code, normalizedCouponCode));
        if (!existingCoupon) throw new NotFoundError("Coupon");
        if (!existingCoupon.active) throw new AppError(400, "Coupon is inactive.", "COUPON_INACTIVE");
        if (existingCoupon.expiresAt && existingCoupon.expiresAt < new Date()) {
          throw new AppError(400, "Coupon has expired.", "COUPON_EXPIRED");
        }
        throw new AppError(400, "Coupon usage limit reached.", "COUPON_LIMIT");
      }
      discountFraction = Number(claimedCoupon.discount);
      couponCode = claimedCoupon.code;
    }

    const subtotal = computeSubtotal(lockedProducts);
    const totals = computeTotals(subtotal, applyCouponToSubtotal(subtotal, discountFraction), couponCode);
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

    for (const line of lockedProducts) {
      await tx.insert(orderItems).values({
        orderId,
        productId: line.id,
        name: line.name,
        price: line.price.toFixed(2),
        img: line.img,
        qty: line.qty
      });
    }

    return { order, totals, couponCode, now };
  });

  // -- Payment initiation --
  let payment: PaymentProviderResult | null = null;
  try {
    payment = await createPaymentIntent({
      method: input.paymentMethod,
      amount: result.totals.total,
      orderId,
      currency: "szl",
      email: shippingEmail,
      paymentNumber: input.paymentNumber
    });
    if (payment && payment.paymentIntentId) {
      await db
        .update(orders)
        .set({
          paymentIntentId: payment.paymentIntentId,
          paymentStatus: payment.status === "succeeded" ? "paid" : "pending",
          updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));
    }
  } catch (err) {
    // Payment initiation failure must release the reservation rather than leave
    // inventory and coupon use consumed by an order that cannot be paid.
    await releaseReservedOrder(orderId);
    logger.warn({ err, orderId }, "Payment initiation failed; order reservation released");
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
    subtotal: result.totals.subtotal,
    tax: result.totals.tax,
    discount: result.totals.discount,
    total: result.totals.total,
    couponCode: result.couponCode ?? null,
    shipping: input.shipping,
    items: lockedProducts.map((p) => ({ productId: p.id, name: p.name, price: p.price, qty: p.qty })),
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
        msg: `Order #${orderId.substring(0, 8)} received. Total: E${result.totals.total.toFixed(2)}`
      })
      .catch(() => undefined);
  }

  return { order: payload, payment };
}

/**
 * Release a pending order reservation after a known payment failure. The row lock
 * makes concurrent paid/failed transitions resolve to exactly one outcome.
 */
export async function releaseReservedOrder(orderId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.paymentStatus !== "pending") return false;

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .for("update");
      if (!product) {
        logger.warn({ orderId, productId: item.productId }, "Product missing while releasing reservation");
        continue;
      }
      await tx
        .update(products)
        .set({ stock: product.stock + item.qty, updatedAt: new Date() })
        .where(eq(products.id, item.productId));
    }

    if (order.couponCode) {
      await tx
        .update(coupons)
        .set({ uses: sql`GREATEST(${coupons.uses} - 1, 0)` })
        .where(eq(coupons.code, order.couponCode));
    }

    await tx
      .update(orders)
      .set({ paymentStatus: "failed", updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "pending")));
    return true;
  });
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

import { Router } from "express";
import { verifyStripeWebhook } from "../services/payment.service.js";
import { db } from "../db/index.js";
import { orders } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/http.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function markOrderPaid(orderId: string): Promise<void> {
  await db.update(orders).set({ paymentStatus: "paid" }).where(eq(orders.id, orderId));
  logger.info({ orderId }, "Order marked paid via webhook");
}

router.post(
  "/webhook/stripe",
  // raw body required for signature verification — handled via express.raw in app.ts
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) {
      res.status(400).json({ error: "Missing signature.", code: "BAD_REQUEST" });
      return;
    }
    const event = await verifyStripeWebhook((req as any).rawBody ?? "", signature);

    if (event.type === "payment_intent.succeeded" || event.type === "checkout.session.completed") {
      const pi = event.data.object as any;
      const orderId = pi.metadata?.orderId ?? pi.metadata?.order_id;
      if (orderId) await markOrderPaid(orderId);
    }
    res.json({ received: true });
  })
);

/**
 * MTN MoMo Collection callback. MTN POSTs to the configured X-Callback-Url with the
 * transaction reference (header X-Reference-Id and/or body). We match it against the
 * paymentIntentId stored on the order.
 */
router.post(
  "/webhook/momo",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const referenceId = (req.headers["x-reference-id"] as string) ?? body.referenceId ?? body.externalId ?? body.reference;
    if (referenceId) {
      const [order] = await db.select().from(orders).where(eq(orders.paymentIntentId, referenceId));
      if (order) {
        const status = String(body.status ?? "").toUpperCase();
        if (status === "SUCCESSFUL" || status === "PAID" || body.referenceId) {
          await markOrderPaid(order.id);
        } else if (status === "FAILED" || status === "REJECTED" || status === "TIMEOUT") {
          await db.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, order.id));
          logger.info({ orderId: order.id, status }, "Order marked failed via MoMo webhook");
        }
      } else {
        logger.warn({ referenceId }, "MoMo webhook reference did not match any order");
      }
    }
    res.json({ received: true });
  })
);

/**
 * InstaCash gateway callback. The merchant gateway posts a status update with a
 * reference/order id; match on paymentIntentId or order id.
 */
router.post(
  "/webhook/instacash",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const ref = String(body.reference ?? body.transactionId ?? body.orderId ?? body.externalId ?? "");
    if (ref) {
      const [byIntent] = await db.select().from(orders).where(eq(orders.paymentIntentId, ref)).limit(1);
      const [byOrderId] = byIntent
        ? []
        : await db.select().from(orders).where(eq(orders.id, ref)).limit(1);
      const order = byIntent ?? byOrderId;
      if (order) {
        const status = String(body.status ?? "").toUpperCase();
        if (status === "SUCCESSFUL" || status === "PAID" || status === "SUCCESS") {
          await markOrderPaid(order.id);
        } else if (status === "FAILED" || status === "REJECTED") {
          await db.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, order.id));
        }
      }
    }
    res.json({ received: true });
  })
);

export default router;
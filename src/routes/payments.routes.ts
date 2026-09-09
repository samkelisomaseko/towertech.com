import { Router } from "express";
import { verifyStripeWebhook, getWebhookSecret, verifyWebhookSecret } from "../services/payment.service.js";
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

const CONFIRM_STATUSES = new Set(["SUCCESSFUL", "PAID", "SUCCESS"]);
const FAIL_STATUSES = new Set(["FAILED", "REJECTED", "TIMEOUT"]);

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
      if (orderId) {
        // Verify amount matches before marking paid
        const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
        if (!order) {
          logger.warn({ orderId }, "Stripe webhook: order not found");
          res.json({ received: true });
          return;
        }
        // Stripe amounts are in minor units (cents); order.total is in major units (SZL)
        const stripeAmount = event.type === "checkout.session.completed"
          ? (pi.amount_total ?? pi.amount)
          : pi.amount;
        const expectedAmount = Math.round(Number(order.total) * 100);
        const currency = (pi.currency ?? "").toUpperCase();
        if (stripeAmount != null && stripeAmount !== expectedAmount) {
          logger.warn({ orderId, stripeAmount, expectedAmount, currency }, "Stripe webhook: amount mismatch — refusing to mark paid");
          res.status(400).json({ error: "Amount mismatch.", code: "AMOUNT_MISMATCH" });
          return;
        }
        if (currency && currency !== "SZL") {
          logger.warn({ orderId, currency }, "Stripe webhook: currency mismatch — refusing to mark paid");
          res.status(400).json({ error: "Currency mismatch.", code: "CURRENCY_MISMATCH" });
          return;
        }
        await markOrderPaid(orderId);
      }
    }
    res.json({ received: true });
  })
);

/**
 * MTN MoMo Collection callback. Requires webhook secret verification.
 * Only marks paid on explicit success status — bare reference presence is NOT sufficient.
 */
router.post(
  "/webhook/momo",
  asyncHandler(async (req, res) => {
    const secret = await getWebhookSecret();
    if (!secret) {
      logger.error("MoMo webhook secret not configured — rejecting request");
      res.status(401).json({ error: "Webhook secret not configured.", code: "WEBHOOK_SECRET_MISSING" });
      return;
    }
    const provided = (req.headers["x-webhook-secret"] as string) ?? (req.body?._secret as string) ?? "";
    if (!verifyWebhookSecret(provided, secret)) {
      logger.warn("MoMo webhook: invalid or missing secret");
      res.status(401).json({ error: "Invalid webhook secret.", code: "UNAUTHORIZED" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, any>;
    const referenceId = (req.headers["x-reference-id"] as string) ?? body.referenceId ?? body.externalId ?? body.reference;
    if (referenceId) {
      const [order] = await db.select().from(orders).where(eq(orders.paymentIntentId, referenceId));
      if (order) {
        const status = String(body.status ?? "").toUpperCase();
        if (CONFIRM_STATUSES.has(status)) {
          await markOrderPaid(order.id);
        } else if (FAIL_STATUSES.has(status)) {
          await db.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, order.id));
          logger.info({ orderId: order.id, status }, "Order marked failed via MoMo webhook");
        } else {
          logger.info({ orderId: order.id, status }, "MoMo webhook: unrecognised status, no action taken");
        }
      } else {
        logger.warn({ referenceId }, "MoMo webhook reference did not match any order");
      }
    }
    res.json({ received: true });
  })
);

/**
 * InstaCash gateway callback. Requires webhook secret verification.
 * Only marks paid on explicit success status.
 */
router.post(
  "/webhook/instacash",
  asyncHandler(async (req, res) => {
    const secret = await getWebhookSecret();
    if (!secret) {
      logger.error("InstaCash webhook secret not configured — rejecting request");
      res.status(401).json({ error: "Webhook secret not configured.", code: "WEBHOOK_SECRET_MISSING" });
      return;
    }
    const provided = (req.headers["x-webhook-secret"] as string) ?? (req.body?._secret as string) ?? "";
    if (!verifyWebhookSecret(provided, secret)) {
      logger.warn("InstaCash webhook: invalid or missing secret");
      res.status(401).json({ error: "Invalid webhook secret.", code: "UNAUTHORIZED" });
      return;
    }

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
        if (CONFIRM_STATUSES.has(status)) {
          await markOrderPaid(order.id);
        } else if (FAIL_STATUSES.has(status)) {
          await db.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, order.id));
        } else {
          logger.info({ orderId: order.id, status }, "InstaCash webhook: unrecognised status, no action taken");
        }
      }
    }
    res.json({ received: true });
  })
);

export default router;
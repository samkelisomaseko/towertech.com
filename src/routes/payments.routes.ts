import { Router } from "express";
import { getMomoTransactionStatus, verifyStripeWebhook } from "../services/payment.service.js";
import {
  decideInstaCashWebhookAction,
  decideMomoWebhookAction,
  firstHeaderValue,
  isMomoReferenceId,
  stripeAmountMatchesOrder
} from "../services/payment-webhooks.js";
import { releaseReservedOrder } from "../services/order.service.js";
import { db } from "../db/index.js";
import { orders } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../lib/http.js";
import { logger } from "../lib/logger.js";

const router = Router();

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return firstHeaderValue(...values);
}

async function transitionOrderToPaid(orderId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.paymentStatus !== "pending") return false;
    await tx
      .update(orders)
      .set({ paymentStatus: "paid", updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "pending")));
    return true;
  });
}

async function keepOrderPending(orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ paymentStatus: "pending", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "pending")));
}

router.post(
  "/webhook/stripe",
  // raw body required for signature verification — handled via express.raw in app.ts
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !signature) {
      res.status(400).json({ error: "Missing signature.", code: "BAD_REQUEST" });
      return;
    }
    const rawBody = (req as { rawBody?: unknown }).rawBody;
    const rawBodyText = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
    const event = await verifyStripeWebhook(rawBodyText, signature);

    if (event.type === "payment_intent.succeeded" || event.type === "checkout.session.completed") {
      const obj = event.data.object as {
        metadata?: { orderId?: string; order_id?: string };
        amount_received?: unknown;
        amount_total?: unknown;
        payment_status?: unknown;
      };
      const orderId = obj.metadata?.orderId ?? obj.metadata?.order_id;
      if (!orderId) {
        logger.warn("Stripe webhook ignored: no orderId in metadata");
        res.json({ received: true });
        return;
      }
      // checkout.sessions carry amount_total (not amount_received) and must be paid.
      if (event.type === "checkout.session.completed" && obj.payment_status !== "paid") {
        logger.warn({ orderId, payment_status: obj.payment_status }, "Stripe checkout session not paid; order left pending");
        res.json({ received: true });
        return;
      }
      const amountCents = event.type === "checkout.session.completed" ? obj.amount_total : obj.amount_received;
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) {
        logger.warn({ orderId }, "Stripe webhook referenced unknown order");
        res.json({ received: true });
        return;
      }
      if (!stripeAmountMatchesOrder(amountCents, order.total)) {
        logger.warn(
          { orderId, amountCents, total: order.total },
          "Stripe webhook amount does not match order total; order left pending"
        );
        res.json({ received: true, reconciliation: "mismatch" });
        return;
      }
      {
        const transitioned = await transitionOrderToPaid(orderId);
        logger.info({ orderId, transitioned }, "Stripe webhook processed");
      }
    }
    res.json({ received: true });
  })
);

/**
 * MTN MoMo Collection callback. MTN POSTs to the configured X-Callback-Url, but the
 * callback carries no signature or shared-secret authentication. It is therefore only
 * a trigger: the application asks MTN for the authoritative transaction state and
 * acts solely on that response.
 */
router.post(
  "/webhook/momo",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = decideMomoWebhookAction({
      status: body.status,
      referenceId: req.headers["x-reference-id"],
      externalId: body.externalId,
      reference: body.reference
    });
    if (decision === "ignore") {
      logger.warn("MoMo webhook ignored: no payment reference supplied");
      res.json({ received: true, reconciliation: "ignored" });
      return;
    }

    const referenceId = firstNonEmptyString(
      req.headers["x-reference-id"],
      body.referenceId,
      body.externalId,
      body.reference
    );
    if (!referenceId) {
      logger.warn("MoMo webhook ignored: payment reference was empty");
      res.json({ received: true, reconciliation: "ignored" });
      return;
    }
    if (!isMomoReferenceId(referenceId)) {
      logger.warn({ referenceId }, "MoMo webhook ignored: malformed payment reference");
      res.json({ received: true, reconciliation: "ignored" });
      return;
    }

    const [order] = await db.select().from(orders).where(eq(orders.paymentIntentId, referenceId));
    if (!order) {
      logger.warn({ referenceId }, "MoMo webhook reference did not match any order");
      res.json({ received: true, reconciliation: "ignored" });
      return;
    }

    let transaction;
    try {
      transaction = await getMomoTransactionStatus(referenceId);
    } catch (err) {
      logger.warn({ err, orderId: order.id, referenceId }, "MoMo provider lookup failed; order left pending");
      throw err;
    }

    if (transaction.externalId && transaction.externalId !== order.id) {
      logger.warn(
        { orderId: order.id, referenceId, externalId: transaction.externalId },
        "MoMo provider record does not match this order"
      );
      res.json({ received: true, reconciliation: "mismatch" });
      return;
    }
    if (transaction.amount !== undefined && Math.abs(transaction.amount - Number(order.total)) > 0.005) {
      logger.warn(
        { orderId: order.id, referenceId, amount: transaction.amount, total: order.total },
        "MoMo provider amount does not match this order"
      );
      res.json({ received: true, reconciliation: "mismatch" });
      return;
    }

    if (transaction.status === "SUCCESSFUL") {
      const transitioned = await transitionOrderToPaid(order.id);
      logger.info({ orderId: order.id, transitioned }, "Order marked paid from MTN-confirmed transaction");
    } else if (transaction.status === "PENDING") {
      await keepOrderPending(order.id);
      logger.info({ orderId: order.id }, "MTN transaction still pending; order left pending");
    } else if (
      transaction.status === "FAILED" ||
      transaction.status === "REJECTED" ||
      transaction.status === "TIMEOUT"
    ) {
      const released = await releaseReservedOrder(order.id);
      logger.info(
        { orderId: order.id, status: transaction.status, released },
        "MTN-confirmed failure; reservation released"
      );
    } else {
      logger.warn(
        { orderId: order.id, referenceId, status: transaction.status },
        "MTN transaction status unrecognized; order left unchanged"
      );
    }
    res.json({ received: true, reconciliation: "verified" });
  })
);

/**
 * InstaCash gateway callback. The supplied gateway contract has no authentication or
 * status-query mechanism, so an incoming callback cannot prove payment by itself. Hold
 * the order in its current state for provider-side/manual confirmation instead of
 * marking it paid or failed from untrusted input.
 */
router.post(
  "/webhook/instacash",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = decideInstaCashWebhookAction({
      status: body.status,
      reference: body.reference,
      transactionId: body.transactionId,
      orderId: body.orderId,
      externalId: body.externalId
    });
    if (decision === "ignore") {
      logger.warn("InstaCash webhook ignored: no payment reference supplied");
      res.json({ received: true, reconciliation: "ignored" });
      return;
    }

    const reference = firstNonEmptyString(
      body.reference,
      body.transactionId,
      body.orderId,
      body.externalId
    );
    logger.warn(
      { reference, status: body.status },
      "InstaCash callback held for provider confirmation; order state unchanged"
    );
    res.status(202).json({ received: true, reconciliation: "awaiting-provider-confirmation" });
  })
);

export default router;
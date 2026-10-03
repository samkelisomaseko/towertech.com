import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import {
  assertWritableSettings,
  buildPublicSettings,
  getPaymentAvailability
} from "../services/payment-credentials.js";
export {
  MANAGED_ENV_SECRETS,
  MANAGED_SETTING_SECRET_KEYS,
  PUBLIC_SETTINGS,
  assertWritableSettings,
  buildPublicSettings,
  getPaymentAvailability,
  isManagedSecretKey
} from "../services/payment-credentials.js";
export type { PaymentAvailability, PaymentCredentials, PublicSettingRow } from "../services/payment-credentials.js";
import { validateBody } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { settings, logs } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { env } from "../config.js";

const router = Router();

router.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(settings);
    const availability = getPaymentAvailability({
      stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY,
      momoSubscriptionKey: env.MOMO_SUBSCRIPTION_KEY,
      momoApiUser: env.MOMO_API_USER,
      momoApiKey: env.MOMO_API_KEY,
      instacashEndpoint: env.INSTACASH_ENDPOINT,
      instacashApiKey: env.INSTACASH_API_KEY
    });
    res.json({
      settings: buildPublicSettings(rows, availability, env.STRIPE_PUBLISHABLE_KEY)
    });
  })
);

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(settings);
    res.json({ settings: rows.map((s) => ({ key: s.key, value: maskSecrets(s.key, String(s.value)) })) });
  })
);

router.put(
  "/",
  requireAdmin,
  validateBody(z.record(z.string(), z.unknown())),
  asyncHandler(async (req, res) => {
    assertWritableSettings(req.body as Record<string, unknown>);
    for (const [key, value] of Object.entries(req.body)) {
      if (isSecret(key) && typeof value === "string" && value === "********") continue; // unchanged
      await db
        .insert(settings)
        .values({ key, value: typeof value === "string" ? value : JSON.stringify(value) })
        .onConflictDoUpdate({ target: settings.key, set: { value: typeof value === "string" ? value : JSON.stringify(value) } });
    }
    res.json({ ok: true });
  })
);

router.get(
  "/logs",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(logs).orderBy(desc(logs.createdAt)).limit(200);
    res.json({
      logs: rows.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt }))
    });
  })
);

function isSecret(key: string): boolean {
  return /secret|key|token|password|pass/i.test(key);
}

function maskSecrets(key: string, value: string): string {
  // Every secret-looking key is masked regardless of value length — a short
  // webhook secret in the clear is still the whole secret.
  if (isSecret(key)) return "********";
  return value;
}

export default router;
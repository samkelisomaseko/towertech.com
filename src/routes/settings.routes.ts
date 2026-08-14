import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { settings, logs } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { env } from "../config.js";

const router = Router();

// Public whitelist of settings safe to expose to the client.
const PUBLIC_SETTINGS = new Set(["hero_config", "stripeKey", "site_name", "currency"]);

router.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(settings);
    const out: Record<string, string> = {};
    for (const s of rows) {
      if (PUBLIC_SETTINGS.has(s.key)) out[s.key] = String(s.value);
    }
    // Expose which payment rails are actually configured so the client can
    // disable unusable options (without leaking any secrets).
    const has = (key: string) => rows.some((s) => s.key === key && String(s.value) !== "" && String(s.value) !== "********");
    out.payments = JSON.stringify({
      card: has("stripeKey") || !!env.STRIPE_PUBLISHABLE_KEY,
      momo: has("momoSubscriptionKey") && has("momoApiUser") && has("momoApiKey"),
      instacash: has("instaEndpoint") && has("instaApiKey")
    });
    res.json({ settings: out });
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
  if (isSecret(key) && value.length > 4) return "********";
  return value;
}

export default router;
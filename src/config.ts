import "dotenv/config";
import { z } from "zod";

const DEV_JWT_SECRET = "dev-secret-change-me-in-production-0123456789";
const DEV_ADMIN_PASSWORD = "towertechIT31A";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const envBoolean = (defaultValue: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : value === true || value === "true"),
    z.boolean()
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SUPABASE_DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z
    .string()
    .min(48, "JWT_SECRET must be a unique random string of at least 48 characters.")
    .refine((value) => value !== DEV_JWT_SECRET, "JWT_SECRET must not use the development default."),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_ISSUER: z.string().min(1).default("towertech"),
  JWT_AUDIENCE: z.string().min(1).default("towertech-app"),
  COOKIE_SECURE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  TRUST_PROXY: z.coerce.number().default(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  DB_AUTO_MIGRATE: envBoolean(true),
  DB_AUTO_SEED: envBoolean(true),
  ADMIN_EMAIL: z.string().email().default("admin@towertech.com"),
  ADMIN_PASSWORD: z
    .string()
    .min(12, "ADMIN_PASSWORD must be at least 12 characters.")
    .refine((value) => value !== DEV_ADMIN_PASSWORD, "ADMIN_PASSWORD must not use the development default."),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().optional()).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional().default("TowerTech <no-reply@towertech.sz>"),
  NOTIFY_CONTACT_EMAIL: z.string().email().optional().default("contact@towertech.sz"),
  NOTIFY_BUGS_EMAIL: z.string().email().optional().default("bugs@towertech.sz"),
  // MTN MoMo Collection API (Eswatini). These can also be managed at runtime via admin settings.
  MOMO_COLLECTION_URL: z.string().url().optional().default("https://sandbox.momodeveloper.mtn.com/collection"),
  MOMO_TARGET_ENVIRONMENT: z.string().optional().default("sandbox"),
  MOMO_SUBSCRIPTION_KEY: z.string().optional(),
  MOMO_API_USER: z.string().optional(),
  MOMO_API_KEY: z.string().optional(),
  MOMO_CALLBACK_URL: optionalUrl,
  // InstaCash gateway (endpoint + API key configured by the merchant). No public API spec exists,
  // so this stays configurable: the merchant supplies the real collection endpoint + key.
  INSTACASH_ENDPOINT: optionalUrl,
  INSTACASH_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional().default("deepseek/deepseek-chat"),
  AI_API_KEY: z.string().optional(),
  AI_ENABLED: envBoolean(true)
});

export function parseEnv(source: Record<string, string | undefined> = process.env) {
  return envSchema.safeParse(source);
}

const parsed = parseEnv();

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === "production") {
  const problems: string[] = [];
  if (env.JWT_SECRET === DEV_JWT_SECRET || env.JWT_SECRET.length < 48) {
    problems.push("JWT_SECRET must be a unique random string of at least 48 characters in production.");
  }
  if (env.ADMIN_PASSWORD === DEV_ADMIN_PASSWORD) {
    problems.push("ADMIN_PASSWORD must be changed from the development default in production.");
  }
  const stripeKeys = [env.STRIPE_SECRET_KEY, env.STRIPE_PUBLISHABLE_KEY, env.STRIPE_WEBHOOK_SECRET];
  if (stripeKeys.some(Boolean) && !stripeKeys.every(Boolean)) {
    problems.push("Stripe is partially configured: provide STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET together, or leave all three empty to disable Stripe.");
  }
  const smtpKeys = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS];
  if (smtpKeys.some(Boolean) && !smtpKeys.every(Boolean)) {
    problems.push("SMTP is partially configured: provide SMTP_HOST, SMTP_USER and SMTP_PASS together, or leave all three empty to disable email.");
  }
  if (env.COOKIE_SECURE === false) {
    problems.push("COOKIE_SECURE must be true in production.");
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error("❌ Production configuration refused to start:");
    for (const p of problems) console.error("   • " + p);
    process.exit(1);
  }
}

export { env };

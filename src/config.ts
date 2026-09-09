import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32).default("dev-secret-change-me-in-production-0123456789"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECURE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  TRUST_PROXY: z.coerce.number().default(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  ADMIN_EMAIL: z.string().email().default("admin@towertech.com"),
  ADMIN_PASSWORD: z.string().min(8).default("towertechIT31A"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(587),
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
  MOMO_CALLBACK_URL: z.string().url().optional(),
  // InstaCash gateway (endpoint + API key configured by the merchant). No public API spec exists,
  // so this stays configurable: the merchant supplies the real collection endpoint + key.
  INSTACASH_ENDPOINT: z.string().url().optional(),
  INSTACASH_API_KEY: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional()
});

const DEV_JWT_SECRET = "dev-secret-change-me-in-production-0123456789";
const DEV_ADMIN_PASSWORD = "towertechIT31A";

const parsed = envSchema.safeParse(process.env);

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
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    problems.push("STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET are required in production.");
  }
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    problems.push("SMTP_HOST, SMTP_USER and SMTP_PASS are required in production for transactional email.");
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

import { AppError } from "../lib/http.js";

// Payment credentials are managed exclusively through environment/secret-manager
// configuration. They must never be written to, or read back from, runtime settings.
export const MANAGED_ENV_SECRETS = new Set([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MOMO_SUBSCRIPTION_KEY",
  "MOMO_API_USER",
  "MOMO_API_KEY",
  "INSTACASH_API_KEY",
  "AI_API_KEY"
]);

export const MANAGED_SETTING_SECRET_KEYS = new Set([
  "momoSubscriptionKey",
  "momoApiUser",
  "momoApiKey",
  "instaApiKey",
  "stripeSecretKey",
  "stripeWebhookSecret"
]);

// Public whitelist of settings safe to expose to the client.
export const PUBLIC_SETTINGS = new Set(["hero_config", "site_name", "currency", "ai_model", "ai_enabled"]);

// Admin-configurable AI settings keys (stored in settings table, ai_api_key masked).
export const AI_SETTING_KEYS = new Set(["ai_model", "ai_api_key", "ai_enabled"]);

export interface PublicSettingRow {
  key: string;
  value: unknown;
}

export interface PaymentCredentials {
  stripePublishableKey?: string;
  momoSubscriptionKey?: string;
  momoApiUser?: string;
  momoApiKey?: string;
  instacashEndpoint?: string;
  instacashApiKey?: string;
}

export interface PaymentAvailability {
  card: boolean;
  momo: boolean;
  instacash: boolean;
}

export function isManagedSecretKey(key: string): boolean {
  return MANAGED_ENV_SECRETS.has(key) || MANAGED_SETTING_SECRET_KEYS.has(key);
}

export function assertWritableSettings(body: Record<string, unknown>): void {
  const rejected = Object.keys(body).filter((key) => isManagedSecretKey(key));
  if (rejected.length > 0) {
    throw new AppError(
      400,
      `These payment credentials are managed through environment configuration and cannot be stored as runtime settings: ${rejected.join(", ")}.`,
      "MANAGED_SECRET",
      { keys: rejected }
    );
  }
}

function hasCredential(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getPaymentAvailability(credentials: PaymentCredentials): PaymentAvailability {
  return {
    card: hasCredential(credentials.stripePublishableKey),
    momo:
      hasCredential(credentials.momoSubscriptionKey) &&
      hasCredential(credentials.momoApiUser) &&
      hasCredential(credentials.momoApiKey),
    instacash: hasCredential(credentials.instacashEndpoint) && hasCredential(credentials.instacashApiKey)
  };
}

export function buildPublicSettings(
  rows: PublicSettingRow[],
  availability: PaymentAvailability,
  stripePublishableKey?: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (PUBLIC_SETTINGS.has(row.key)) out[row.key] = String(row.value);
  }
  if (stripePublishableKey) out.stripePublishableKey = stripePublishableKey;
  out.payments = JSON.stringify(availability);
  return out;
}

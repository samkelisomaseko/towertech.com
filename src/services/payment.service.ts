import Stripe from "stripe";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config.js";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/http.js";
import { normalizeMomoProviderStatus } from "./payment-webhooks.js";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!env.STRIPE_SECRET_KEY) throw new AppError(503, "Stripe is not configured.", "STRIPE_NOT_CONFIGURED");
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export interface PaymentProviderResult {
  provider: "stripe" | "momo" | "instacash";
  method: "card" | "momo" | "instacash";
  paymentIntentId?: string;
  clientSecret?: string;
  status: "requires_action" | "succeeded" | "pending";
  reference?: string;
  instructions?: string;
}

interface CreatePaymentIntentInput {
  method: "card" | "momo" | "instacash";
  amount: number;
  orderId: string;
  currency?: string;
  email?: string;
  paymentNumber?: string;
}

/**
 * Fetch a runtime setting value (admin-configurable) with an env fallback.
 */
async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (row) {
    const v = String(row.value);
    if (v && v !== "********" && v !== "") return v;
  }
  return null;
}

interface MoMoConfig {
  collectionUrl: string;
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  environment: string;
  callbackUrl?: string;
}

interface InstaConfig {
  endpoint?: string;
  apiKey?: string;
}

async function getMomoConfig(): Promise<MoMoConfig> {
  const [environment, callbackUrl] = await Promise.all([
    getSetting("momoEnvironment"),
    getSetting("momoCallbackUrl")
  ]);
  return {
    collectionUrl: env.MOMO_COLLECTION_URL,
    subscriptionKey: env.MOMO_SUBSCRIPTION_KEY,
    apiUser: env.MOMO_API_USER,
    apiKey: env.MOMO_API_KEY,
    environment: environment ?? env.MOMO_TARGET_ENVIRONMENT,
    callbackUrl: callbackUrl ?? env.MOMO_CALLBACK_URL
  };
}

async function getInstaConfig(): Promise<InstaConfig> {
  const endpoint = await getSetting("instaEndpoint");
  return { endpoint: endpoint ?? env.INSTACASH_ENDPOINT, apiKey: env.INSTACASH_API_KEY };
}

/**
 * Fetch the shared webhook secret (admin-configurable) with env fallback.
 * Returns null if neither is set — callers MUST reject with 401 when null.
 */
export async function getWebhookSecret(): Promise<string | null> {
  const setting = await getSetting("webhookSecret");
  return setting ?? env.WEBHOOK_SECRET ?? null;
}

/**
 * Constant-time compare of two strings. Returns false on length mismatch (no exception).
 */
export function verifyWebhookSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let momoToken: { token: string; expiresAt: number } | null = null;

/** Normalize an Eswatini phone number to international MSISDN (268XXXXXXXX). */
export function normalizeEswatiniMsisdn(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("268")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 8) throw new AppError(400, "Enter a valid Eswatini mobile number (+268 7X XXX XXXX).", "INVALID_MSISDN");
  return "268" + digits;
}

/** Obtain a MoMo Collection access token (cached for 1h). */
async function getMoMoToken(): Promise<{ token: string; expiresAt: number }> {
  const cfg = await getMomoConfig();
  if (!cfg.subscriptionKey || !cfg.apiUser || !cfg.apiKey) {
    throw new AppError(503, "MTN MoMo is not configured. Add API credentials to environment configuration.", "MOMO_NOT_CONFIGURED");
  }
  const basic = Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString("base64");
  const res = await fetch(`${cfg.collectionUrl.replace(/\/$/, "")}/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "MTN MoMo token request failed");
    throw new AppError(502, "MTN MoMo could not be reached. Try again shortly.", "MOMO_TOKEN_ERROR");
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: string };
  if (!data.access_token) throw new AppError(502, "MTN MoMo did not return an access token.", "MOMO_TOKEN_ERROR");
  const expiresIn = Number(data.expires_in ?? 3600) * 1000;
  return { token: data.access_token, expiresAt: Date.now() + expiresIn };
}

export type MomoTransactionStatus = "SUCCESSFUL" | "PENDING" | "FAILED" | "REJECTED" | "TIMEOUT" | "UNKNOWN";

export interface MomoTransaction {
  status: MomoTransactionStatus;
  amount?: number;
  currency?: string;
  externalId?: string;
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Ask MTN for the authoritative state of a request-to-pay. This is the only MoMo
 * state the application may act on; the callback body/header is untrusted input.
 */
export async function getMomoTransactionStatus(referenceId: string): Promise<MomoTransaction> {
  const cfg = await getMomoConfig();
  if (!momoToken || momoToken.expiresAt < Date.now()) {
    momoToken = await getMoMoToken();
  }

  const res = await fetch(
    `${cfg.collectionUrl.replace(/\/$/, "")}/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
    {
      headers: {
        Authorization: `Bearer ${momoToken.token}`,
        "X-Target-Environment": cfg.environment,
        "Ocp-Apim-Subscription-Key": cfg.subscriptionKey ?? ""
      }
    }
  );
  if (res.status === 404) {
    throw new AppError(502, "MTN MoMo has no record of this payment reference.", "MOMO_REFERENCE_UNKNOWN");
  }
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body, referenceId }, "MTN MoMo transaction lookup failed");
    throw new AppError(502, "MTN MoMo could not confirm the payment status.", "MOMO_STATUS_ERROR");
  }

  const data = (await res.json()) as {
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    externalId?: unknown;
  };
  const normalized = normalizeMomoProviderStatus(data.status);
  const status: MomoTransactionStatus =
    normalized === "SUCCESSFUL" ||
    normalized === "PENDING" ||
    normalized === "FAILED" ||
    normalized === "REJECTED" ||
    normalized === "TIMEOUT"
      ? normalized
      : "UNKNOWN";

  return {
    status,
    amount: toFiniteNumber(data.amount),
    currency: asOptionalString(data.currency)?.toUpperCase(),
    externalId: asOptionalString(data.externalId)
  };
}

/** Initiate a MoMo Collection request-to-pay. Returns the X-Reference-Id used to track status. */
async function momoRequestToPay(
  cfg: MoMoConfig,
  token: string,
  input: { amount: number; currency: string; orderId: string; msisdn: string }
): Promise<string> {
  const referenceId = randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Reference-Id": referenceId,
    "X-Target-Environment": cfg.environment,
    "Ocp-Apim-Subscription-Key": cfg.subscriptionKey!,
    "Content-Type": "application/json"
  };
  if (cfg.callbackUrl) headers["X-Callback-Url"] = cfg.callbackUrl;
  const res = await fetch(`${cfg.collectionUrl.replace(/\/$/, "")}/v1_0/requesttopay`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: input.amount.toFixed(2),
      currency: input.currency,
      externalId: input.orderId,
      payer: { partyIdType: "MSISDN", partyId: input.msisdn },
      payerMessage: "TowerTech order payment",
      payeeNote: `Order ${input.orderId}`
    })
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text();
    logger.warn({ status: res.status, body, orderId: input.orderId }, "MTN MoMo request-to-pay failed");
    throw new AppError(502, "MTN MoMo declined the payment request.", "MOMO_REQUEST_FAILED");
  }
  return referenceId;
}

/**
 * Card → real Stripe PaymentIntent (client confirms with the returned secret).
 * MoMo → real MTN MoMo Collection request-to-pay (status confirmed via webhook).
 * InstaCash → configurable gateway adapter; requires an endpoint + API key.
 */
export async function createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentProviderResult> {
  if (input.method === "card") {
    try {
      const intent = await getStripe().paymentIntents.create({
        amount: Math.round(input.amount * 100),
        currency: (input.currency ?? "szl").toLowerCase(),
        receipt_email: input.email,
        metadata: { orderId: input.orderId },
        automatic_payment_methods: { enabled: true }
      });
      return {
        provider: "stripe",
        method: "card",
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret ?? undefined,
        status: "requires_action"
      };
    } catch (err) {
      logger.warn({ err, orderId: input.orderId }, "Stripe payment intent creation failed");
      throw new AppError(502, "Stripe payment could not be initiated.", "STRIPE_ERROR");
    }
  }

  if (input.method === "momo") {
    if (!input.paymentNumber) throw new AppError(400, "A mobile number is required for MoMo.", "MSISDN_REQUIRED");
    const cfg = await getMomoConfig();
    if (!momoToken || momoToken.expiresAt < Date.now()) {
      momoToken = await getMoMoToken();
    }
    const msisdn = normalizeEswatiniMsisdn(input.paymentNumber);
    const referenceId = await momoRequestToPay(cfg, momoToken.token, {
      amount: input.amount,
      currency: (input.currency ?? "SZL").toUpperCase(),
      orderId: input.orderId,
      msisdn
    });
    logger.info({ orderId: input.orderId, referenceId }, "MTN MoMo request-to-pay initiated");
    return {
      provider: "momo",
      method: "momo",
      paymentIntentId: referenceId,
      reference: referenceId,
      status: "pending",
      instructions: `Check your MTN MoMo wallet and approve the payment request of ${formatMoney(input.amount)}.`
    };
  }

  // InstaCash — configurable gateway adapter. Real merchant endpoint required.
  const insta = await getInstaConfig();
  if (!insta.endpoint || !insta.apiKey) {
    throw new AppError(503, "InstaCash is not configured. Add the gateway endpoint and API key to environment configuration.", "INSTACASH_NOT_CONFIGURED");
  }
  if (!input.paymentNumber) throw new AppError(400, "A mobile number is required for InstaCash.", "MSISDN_REQUIRED");
  const msisdn = normalizeEswatiniMsisdn(input.paymentNumber);
  try {
    const res = await fetch(insta.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${insta.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: input.amount.toFixed(2),
        currency: (input.currency ?? "SZL").toUpperCase(),
        phone: msisdn,
        reference: input.orderId
      })
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body, orderId: input.orderId }, "InstaCash payment request failed");
      throw new AppError(502, "InstaCash declined the payment request.", "INSTACASH_REQUEST_FAILED");
    }
    const data = (await res.json()) as { reference?: string; transactionId?: string; status?: string };
    const ref = data.reference ?? data.transactionId ?? input.orderId;
    logger.info({ orderId: input.orderId, ref }, "InstaCash payment initiated");
    return {
      provider: "instacash",
      method: "instacash",
      paymentIntentId: ref,
      reference: ref,
      status: data.status === "SUCCESSFUL" || data.status === "paid" ? "succeeded" : "pending",
      instructions: `Approve the InstaCash payment of ${formatMoney(input.amount)} on your phone.`
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err, orderId: input.orderId }, "InstaCash payment request failed");
    throw new AppError(502, "InstaCash could not be reached. Try again shortly.", "INSTACASH_ERROR");
  }
}

export function formatMoney(n: number): string {
  return "E" + n.toLocaleString("en-SZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Verify a Stripe webhook signature and return the parsed event. */
export async function verifyStripeWebhook(body: string, signature: string): Promise<Stripe.Event> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, "Stripe webhook secret not configured.", "WEBHOOK_NOT_CONFIGURED");
  const s = getStripe();
  return s.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
}
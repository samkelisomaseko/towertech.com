export type MomoWebhookDecision = "verify-provider" | "ignore";
export type InstaCashWebhookDecision = "awaiting-provider-confirmation" | "ignore";

export interface MomoWebhookInput {
  status?: unknown;
  referenceId?: unknown;
  externalId?: unknown;
  reference?: unknown;
}

export interface InstaCashWebhookInput {
  status?: unknown;
  reference?: unknown;
  transactionId?: unknown;
  orderId?: unknown;
  externalId?: unknown;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const MOMO_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * New MoMo payments use UUID request references. Rejecting other shapes before the
 * provider lookup prevents malformed or probing callbacks from causing outbound MTN calls.
 */
export function isMomoReferenceId(value: unknown): value is string {
  return typeof value === "string" && MOMO_REFERENCE_PATTERN.test(value.trim());
}

/**
 * Normalize a provider status without assigning any trust to it. An untrusted
 * callback is only ever a reason to ask the provider for the authoritative state.
 */
export function normalizeMomoProviderStatus(status: unknown): string {
  return asNonEmptyString(status)?.toUpperCase() ?? "UNKNOWN";
}

/**
 * First usable value from header-like inputs. Node collapses duplicate headers
 * into arrays — take the first non-empty entry instead of throwing or dropping
 * the whole header (which previously surfaced as a 500 downstream).
 */
export function firstHeaderValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) return entry.trim();
      }
    }
  }
  return undefined;
}

/**
 * Compare a Stripe amount (integer cents) against the order total with a 1-cent
 * tolerance for rounding. Null, missing, or non-finite amounts FAIL CLOSED —
 * an unverifiable payment must never mark an order paid.
 */
export function stripeAmountMatchesOrder(amountCents: unknown, orderTotal: number | string): boolean {
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return false;
  const expected = Math.round(Number(orderTotal) * 100);
  if (!Number.isFinite(expected)) return false;
  return Math.abs(Math.round(amountCents) - expected) <= 1;
}
/**
 * Every MoMo callback that carries a reference is a verification request. Even a
 * FAILED status must be confirmed with MTN before changing order state, because
 * the callback itself is unauthenticated.
 */
export function decideMomoWebhookAction(input: MomoWebhookInput): MomoWebhookDecision {
  const referenceId =
    asNonEmptyString(input.referenceId) ??
    asNonEmptyString(input.externalId) ??
    asNonEmptyString(input.reference);
  return referenceId ? "verify-provider" : "ignore";
}

/**
 * The generic InstaCash callback contract carries no authentication or status-query
 * mechanism. It must never transition an order on its own; it only records that a
 * provider-side confirmation still has to happen.
 */
export function decideInstaCashWebhookAction(input: InstaCashWebhookInput): InstaCashWebhookDecision {
  const reference =
    asNonEmptyString(input.reference) ??
    asNonEmptyString(input.transactionId) ??
    asNonEmptyString(input.orderId) ??
    asNonEmptyString(input.externalId);
  return reference ? "awaiting-provider-confirmation" : "ignore";
}

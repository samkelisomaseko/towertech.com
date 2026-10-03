import { describe, expect, it } from "vitest";
import {
  decideInstaCashWebhookAction,
  decideMomoWebhookAction,
  firstHeaderValue,
  isMomoReferenceId,
  normalizeMomoProviderStatus,
  stripeAmountMatchesOrder
} from "../src/services/payment-webhooks.js";

describe("MoMo webhook decisions", () => {
  it("never treats a failed callback as paid, even with a reference ID", () => {
    expect(decideMomoWebhookAction({ status: "FAILED", referenceId: "momo-ref-1" })).toBe("verify-provider");
  });

  it("treats a successful callback as a provider verification request, not proof", () => {
    expect(decideMomoWebhookAction({ status: "SUCCESSFUL", referenceId: "momo-ref-1" })).toBe("verify-provider");
  });

  it("ignores a callback without a reference ID", () => {
    expect(decideMomoWebhookAction({ status: "SUCCESSFUL" })).toBe("ignore");
  });

  it("normalizes provider statuses", () => {
    expect(normalizeMomoProviderStatus("successful")).toBe("SUCCESSFUL");
    expect(normalizeMomoProviderStatus("Timeout")).toBe("TIMEOUT");
  });

  it("accepts only UUID-shaped references before provider lookup", () => {
    expect(isMomoReferenceId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isMomoReferenceId("momo-ref-1")).toBe(false);
    expect(isMomoReferenceId("")).toBe(false);
  });
});

describe("InstaCash webhook decisions", () => {
  it("never marks an order paid from an unauthenticated callback", () => {
    expect(decideInstaCashWebhookAction({ status: "SUCCESS", reference: "ORD-123" })).toBe(
      "awaiting-provider-confirmation"
    );
  });

  it("ignores callbacks without a reference", () => {
    expect(decideInstaCashWebhookAction({ status: "SUCCESS" })).toBe("ignore");
  });
});

describe("Stripe amount verification (Luna regressions)", () => {
  it("fails closed on null/undefined/non-finite amounts", () => {
    expect(stripeAmountMatchesOrder(null, 100)).toBe(false);
    expect(stripeAmountMatchesOrder(undefined, 100)).toBe(false);
    expect(stripeAmountMatchesOrder("10000", 100)).toBe(false);
    expect(stripeAmountMatchesOrder(NaN, 100)).toBe(false);
    expect(stripeAmountMatchesOrder(Infinity, 100)).toBe(false);
  });

  it("accepts exact cent matches and 1-cent rounding", () => {
    expect(stripeAmountMatchesOrder(10000, 100)).toBe(true);
    expect(stripeAmountMatchesOrder(10001, 100)).toBe(true);
    expect(stripeAmountMatchesOrder(9999, 100)).toBe(true);
  });

  it("rejects underpayment beyond 1 cent", () => {
    expect(stripeAmountMatchesOrder(9900, 100)).toBe(false);
    expect(stripeAmountMatchesOrder(5000, 100)).toBe(false);
    expect(stripeAmountMatchesOrder(0, 100)).toBe(false);
  });
});

describe("firstHeaderValue (array-header regression)", () => {
  it("takes the first usable entry from an array header", () => {
    expect(firstHeaderValue(["", "  ", "abc"])).toBe("abc");
    expect(firstHeaderValue(["x", "y"])).toBe("x");
  });

  it("returns undefined for empty arrays and non-strings", () => {
    expect(firstHeaderValue([])).toBeUndefined();
    expect(firstHeaderValue([123, null])).toBeUndefined();
    expect(firstHeaderValue(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  decideInstaCashWebhookAction,
  decideMomoWebhookAction,
  isMomoReferenceId,
  normalizeMomoProviderStatus
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

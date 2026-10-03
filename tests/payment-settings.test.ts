import { describe, expect, it } from "vitest";
import {
  assertWritableSettings,
  buildPublicSettings,
  getPaymentAvailability
} from "../src/routes/settings.routes.js";

describe("payment credential handling", () => {
  it("rejects environment-managed payment secrets from runtime settings", () => {
    expect(() =>
      assertWritableSettings({
        site_name: "TowerTech",
        momoApiKey: "should-not-be-stored",
        INSTACASH_API_KEY: "should-not-be-stored"
      })
    ).toThrow(/managed/i);
  });

  it("exposes the publishable Stripe key without exposing a stored stripeKey", () => {
    const settings = buildPublicSettings(
      [
        { key: "site_name", value: "TowerTech" },
        { key: "stripeKey", value: "sk_live_should_never_appear" }
      ],
      { card: true, momo: false, instacash: false },
      "pk_test_publishable"
    );

    expect(settings.stripePublishableKey).toBe("pk_test_publishable");
    expect(settings).not.toHaveProperty("stripeKey");
  });

  it("derives payment availability only from environment credentials", () => {
    expect(
      getPaymentAvailability({
        stripePublishableKey: "pk_test_publishable",
        momoSubscriptionKey: "subscription",
        momoApiUser: "user",
        momoApiKey: "key",
        instacashEndpoint: "https://gateway.example/pay",
        instacashApiKey: "key"
      })
    ).toEqual({ card: true, momo: true, instacash: true });
  });
});

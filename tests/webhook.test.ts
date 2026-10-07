import { describe, it, expect } from "vitest";
import { verifyWebhookSecret } from "../src/services/payment.service.js";

describe("verifyWebhookSecret", () => {
  it("returns true for matching secrets", () => {
    expect(verifyWebhookSecret("my-secret-123", "my-secret-123")).toBe(true);
  });

  it("returns false for mismatched secrets", () => {
    expect(verifyWebhookSecret("wrong-secret", "my-secret-123")).toBe(false);
  });

  it("returns false for empty provided secret", () => {
    expect(verifyWebhookSecret("", "my-secret-123")).toBe(false);
  });

  it("returns false when expected is empty", () => {
    expect(verifyWebhookSecret("my-secret-123", "")).toBe(false);
  });

  it("returns false for same prefix but different length", () => {
    expect(verifyWebhookSecret("my-secret", "my-secret-123")).toBe(false);
  });

  it("returns true for identical long secrets", () => {
    const secret = "a".repeat(256);
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
  });

  it("returns false when only case differs", () => {
    expect(verifyWebhookSecret("My-Secret", "my-secret")).toBe(false);
  });
});

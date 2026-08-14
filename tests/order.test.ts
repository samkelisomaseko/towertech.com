import { describe, it, expect } from "vitest";
import { computeTotals, TAX_RATE, applyCouponToSubtotal } from "../src/services/order.service.js";

describe("computeTotals", () => {
  it("computes subtotal, tax, and total for a simple order", () => {
    const t = computeTotals(100, 0);
    expect(t.subtotal).toBe(100);
    expect(t.tax).toBe(15);
    expect(t.discount).toBe(0);
    expect(t.total).toBe(115);
  });

  it("applies a 20% coupon discount before tax is added", () => {
    const subtotal = 100;
    const t = computeTotals(subtotal, applyCouponToSubtotal(subtotal, 0.2));
    expect(t.discount).toBe(20);
    expect(t.total).toBe(100 + 15 - 20); // 95
  });

  it("never lets discount exceed subtotal", () => {
    const t = computeTotals(50, 60);
    expect(t.discount).toBe(50);
    expect(t.total).toBe(50 + 50 * TAX_RATE - 50);
  });

  it("rounds to cents", () => {
    const t = computeTotals(19.99, 0);
    expect(t.total).toBe(22.99);
    expect(t.tax).toBe(3.0);
  });

  it("handles zero subtotal", () => {
    const t = computeTotals(0, 0);
    expect(t.total).toBe(0);
  });

  it("carries coupon code through", () => {
    const t = computeTotals(100, 10, "CYBER20");
    expect(t.couponCode).toBe("CYBER20");
  });
});
import { describe, expect, it } from "vitest";
import { computeSubtotal, mergeCartLines } from "../src/services/order.service.js";

describe("computeSubtotal", () => {
  it("multiplies unit price by quantity", () => {
    expect(
      computeSubtotal([
        { price: 100, qty: 3 },
        { price: 19.99, qty: 2 }
      ])
    ).toBe(339.98);
  });

  it("returns zero for an empty cart", () => {
    expect(computeSubtotal([])).toBe(0);
  });
});

describe("mergeCartLines", () => {
  it("sums quantities for duplicate product lines", () => {
    expect(
      mergeCartLines([
        { productId: 1, qty: 2 },
        { productId: 1, qty: 3 },
        { productId: 2, qty: 1 }
      ])
    ).toEqual([
      { productId: 1, qty: 5 },
      { productId: 2, qty: 1 }
    ]);
  });
});

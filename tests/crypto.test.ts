import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto.js";

describe("crypto", () => {
  it("hashes and verifies a password", () => {
    const hash = hashPassword("TowerTech#2026");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("TowerTech#2026", hash)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const hash = hashPassword("correct-horse");
    expect(verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("produces unique salts per call", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("handles malformed stored hashes safely", () => {
    expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto.js";

describe("verifyPassword parameter pinning", () => {
  it("accepts hashes produced by hashPassword", () => {
    const stored = hashPassword("a-strong-enough-password-01");
    expect(verifyPassword("a-strong-enough-password-01", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("rejects stored hashes with non-standard cost parameters", () => {
    const stored = hashPassword("a-strong-enough-password-01");
    const parts = stored.split("$");
    // N=1 is cheap for the attacker to test but must never verify here.
    expect(verifyPassword("a-strong-enough-password-01", ["scrypt", "1", parts[2], parts[3], parts[4], parts[5]].join("$"))).toBe(
      false
    );
    // N=1048576 would demand ~1GB of memory; it must be refused, not computed.
    expect(
      verifyPassword("a-strong-enough-password-01", ["scrypt", "1048576", parts[2], parts[3], parts[4], parts[5]].join("$"))
    ).toBe(false);
  });
});

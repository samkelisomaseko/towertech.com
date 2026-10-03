import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../src/config.js";
import { signSession, verifySession } from "../src/lib/jwt.js";

describe("session tokens", () => {
  it("round-trips through sign and verify", () => {
    const token = signSession({ sub: "buyer@towertech.sz", name: "Buyer", role: "user" });
    expect(verifySession(token)).toMatchObject({ sub: "buyer@towertech.sz", role: "user" });
  });

  it("rejects tampered tokens", () => {
    const token = signSession({ sub: "buyer@towertech.sz", name: "Buyer", role: "user" });
    expect(verifySession(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects tokens minted for a different issuer or audience", () => {
    const foreign = jwt.sign({ sub: "buyer@towertech.sz", name: "Buyer", role: "user" }, env.JWT_SECRET, {
      algorithm: "HS256",
      issuer: "someone-else",
      audience: env.JWT_AUDIENCE
    });
    expect(verifySession(foreign)).toBeNull();
  });
});

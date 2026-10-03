import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config.js";

const validEnv = {
  DATABASE_URL: "postgres://towertech:towertech@localhost:5432/towertech",
  JWT_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  ADMIN_PASSWORD: "replace-this-before-any-shared-deployment-01"
};

describe("environment secrets", () => {
  it("rejects missing JWT and admin secrets", () => {
    const parsed = parseEnv({ ...validEnv, JWT_SECRET: undefined, ADMIN_PASSWORD: undefined });
    expect(parsed.success).toBe(false);
  });

  it("rejects the published development admin password", () => {
    const parsed = parseEnv({ ...validEnv, ADMIN_PASSWORD: "towertechIT31A" });
    expect(parsed.success).toBe(false);
  });

  it("accepts explicitly supplied secrets", () => {
    expect(parseEnv(validEnv).success).toBe(true);
  });
});

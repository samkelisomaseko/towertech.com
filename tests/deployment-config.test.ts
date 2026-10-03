import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");

describe("production deployment configuration", () => {
  it("requires secrets instead of shipping defaults", () => {
    for (const variable of ["POSTGRES_PASSWORD", "JWT_SECRET", "ADMIN_PASSWORD"]) {
      expect(compose).toContain(`\${${variable}:?`);
    }
    expect(compose).not.toContain("POSTGRES_PASSWORD: towertech");
    expect(compose).not.toContain("ADMIN_PASSWORD: towertechIT31A");
    expect(compose).not.toContain("COOKIE_SECURE: \"false\"");
    expect(compose).not.toContain("SEED_MOCK_ORDERS");
  });

  it("does not publish the database to the host", () => {
    expect(compose).not.toMatch(/-\s*"5432:5432"/);
  });
});

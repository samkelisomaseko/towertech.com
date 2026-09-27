import { describe, expect, it } from "vitest";
import { toActiveSessionUser } from "../src/services/auth.service.js";
import type { User } from "../src/db/schema.js";

const activeUser: User = {
  id: 1,
  email: "buyer@towertech.sz",
  name: "Buyer",
  passwordHash: "hash",
  salt: "",
  role: "user",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z")
};

describe("session authorization", () => {
  it("keeps identity and role from the current user record", () => {
    expect(toActiveSessionUser({ ...activeUser, role: "admin", status: "active" })).toEqual({
      sub: activeUser.email,
      name: activeUser.name,
      role: "admin"
    });
  });

  it("rejects banned users immediately", () => {
    expect(toActiveSessionUser({ ...activeUser, status: "banned" })).toBeNull();
  });

  it("rejects missing users and unknown roles safely", () => {
    expect(toActiveSessionUser(undefined)).toBeNull();
    expect(toActiveSessionUser({ ...activeUser, role: "superadmin" })).toEqual({
      sub: activeUser.email,
      name: activeUser.name,
      role: "user"
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validateParams, validateQuery } from "../src/middleware/validate.js";

function mockReq(data: Record<string, unknown>) {
  return { params: { ...data }, query: { ...data } };
}

describe("validateParams", () => {
  it("writes coerced values back to req.params", () => {
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const req = mockReq({ id: "42" });
    const next = vi.fn();
    validateParams(schema)(req as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.params).toEqual({ id: 42 });
  });

  it("rejects invalid params", () => {
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const req = mockReq({ id: "nope" });
    const next = vi.fn();
    validateParams(schema)(req as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeTruthy();
  });
});

describe("validateQuery", () => {
  it("applies defaults and coercions to req.query", () => {
    const schema = z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0)
    });
    const req = mockReq({ limit: "10" });
    const next = vi.fn();
    validateQuery(schema)(req as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ limit: 10, offset: 0 });
  });

  it("rejects out-of-range query values", () => {
    const schema = z.object({ limit: z.coerce.number().int().min(1).max(100) });
    const req = mockReq({ limit: "9999" });
    const next = vi.fn();
    validateQuery(schema)(req as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeTruthy();
  });
});

import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { coupons, Coupon } from "../db/schema.js";
import { AppError, NotFoundError } from "../lib/http.js";
import { z } from "zod";

export const couponInputSchema = z.object({
  code: z.string().min(1).max(32).transform((v) => v.trim().toUpperCase()),
  discount: z.coerce.number().positive().max(0.99, "Discount cannot exceed 99%."),
  desc: z.string().optional().default(""),
  maxUses: z.coerce.number().int().min(0).optional(),
  expiresAt: z.string().datetime().optional()
});

function serialize(c: Coupon) {
  return {
    code: c.code,
    discount: Number(c.discount),
    desc: c.desc,
    active: c.active,
    maxUses: c.maxUses,
    uses: c.uses,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt
  };
}

export async function listCoupons(): Promise<ReturnType<typeof serialize>[]> {
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt));
  return rows.map(serialize);
}

export async function validateCoupon(code: string): Promise<ReturnType<typeof serialize>> {
  const [c] = await db.select().from(coupons).where(eq(coupons.code, code.toUpperCase()));
  if (!c) throw new NotFoundError("Coupon");
  if (!c.active) throw new AppError(400, "Coupon is inactive.", "COUPON_INACTIVE");
  if (c.expiresAt && c.expiresAt < new Date()) throw new AppError(400, "Coupon has expired.", "COUPON_EXPIRED");
  if (c.maxUses != null && c.uses >= c.maxUses) throw new AppError(400, "Coupon usage limit reached.", "COUPON_LIMIT");
  return serialize(c);
}

export async function getCoupon(code: string): Promise<ReturnType<typeof serialize> | null> {
  try {
    return await validateCoupon(code);
  } catch {
    return null;
  }
}

export async function createCoupon(input: z.infer<typeof couponInputSchema>): Promise<ReturnType<typeof serialize>> {
  const existing = await db.select().from(coupons).where(eq(coupons.code, input.code));
  if (existing.length) throw new AppError(409, "Coupon code already exists.", "COUPON_EXISTS");
  const [row] = await db
    .insert(coupons)
    .values({
      code: input.code,
      discount: input.discount.toFixed(4),
      desc: input.desc,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdAt: new Date()
    })
    .returning();
  return serialize(row);
}

export async function deleteCoupon(code: string): Promise<void> {
  const existing = await db.select().from(coupons).where(eq(coupons.code, code.toUpperCase()));
  if (!existing.length) throw new NotFoundError("Coupon");
  await db.delete(coupons).where(eq(coupons.code, code.toUpperCase()));
}

export async function incrementCouponUsage(code: string): Promise<void> {
  await db
    .update(coupons)
    .set({ uses: sql`${coupons.uses} + 1` })
    .where(eq(coupons.code, code.toUpperCase()));
}

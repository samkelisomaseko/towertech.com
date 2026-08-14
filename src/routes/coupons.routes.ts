import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { createCoupon, deleteCoupon, listCoupons, validateCoupon } from "../services/coupon.service.js";

const router = Router();

const codeParam = z.object({ code: z.string().min(1).max(32) });

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ coupons: await listCoupons() });
  })
);

router.post(
  "/validate",
  validateBody(z.object({ code: z.string().min(1).max(32) })),
  asyncHandler(async (req, res) => {
    const coupon = await validateCoupon(req.body.code);
    res.json({ coupon });
  })
);

router.post(
  "/",
  requireAdmin,
  validateBody(
    z.object({
      code: z.string().min(1).max(32),
      discount: z.coerce.number().positive().max(0.99),
      desc: z.string().optional().default(""),
      maxUses: z.coerce.number().int().min(0).optional(),
      expiresAt: z.string().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({ coupon: await createCoupon(req.body) });
  })
);

router.delete(
  "/:code",
  requireAdmin,
  validateParams(codeParam),
  asyncHandler(async (req, res) => {
    await deleteCoupon(req.params.code);
    res.json({ ok: true });
  })
);

export default router;
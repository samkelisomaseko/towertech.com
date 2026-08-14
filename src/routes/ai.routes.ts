import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { processAiIntent } from "../services/ai.service.js";

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  context: z
    .object({
      page: z.string().optional(),
      lastProduct: z.number().nullable().optional()
    })
    .optional()
    .default({})
});

router.post(
  "/chat",
  requireAuth,
  validateBody(chatSchema),
  asyncHandler(async (req, res) => {
    const isAdmin = (req as any).user?.role === "admin";
    const reply = await processAiIntent(req.body.message, {
      ...(req.body.context ?? {}),
      isAdmin
    });
    res.json({ reply });
  })
);

export default router;
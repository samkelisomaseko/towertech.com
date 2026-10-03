import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { requireAdmin, requireAuth, optionalAuth } from "../middleware/auth.js";
import { createProduct, deleteProduct, getAllProducts, getProduct, listProducts, productInputSchema, productQuerySchema, updateProduct } from "../services/product.service.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { reviews } from "../db/schema.js";

const router = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get(
  "/",
  validateQuery(productQuerySchema),
  asyncHandler(async (req, res) => {
    // validateQuery has already coerced req.query in place, so this cast is honest.
    const products = await listProducts(req.query as unknown as z.infer<typeof productQuerySchema>);
    res.json({ products });
  })
);

router.get(
  "/all",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ products: await getAllProducts() });
  })
);

router.get(
  "/:id",
  validateParams(idParam),
  optionalAuth,
  asyncHandler(async (req, res) => {
    const product = await getProduct(Number(req.params.id));
    res.json({ product });
  })
);

router.post(
  "/",
  requireAdmin,
  validateBody(productInputSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ product: await createProduct(req.body) });
  })
);

router.put(
  "/:id",
  requireAdmin,
  validateParams(idParam),
  validateBody(productInputSchema),
  asyncHandler(async (req, res) => {
    res.json({ product: await updateProduct(Number(req.params.id), req.body) });
  })
);

router.delete(
  "/:id",
  requireAdmin,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    await deleteProduct(Number(req.params.id));
    res.json({ ok: true });
  })
);

// ---- Reviews ----
const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().default("")
});

router.get(
  "/:id/reviews",
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    await getProduct(pid);
    const rows = await db.select().from(reviews).where(eq(reviews.productId, pid));
    res.json({
      reviews: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        userId: r.userId,
        name: r.userName,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt
      }))
    });
  })
);

router.post(
  "/:id/reviews",
  requireAuth,
  validateParams(idParam),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    await getProduct(pid); // throws 404 when missing
    const name = req.user!.name;
    const now = new Date();
    const [row] = await db
      .insert(reviews)
      .values({
        productId: pid,
        userId: req.user!.sub,
        userName: name,
        rating: req.body.rating,
        comment: req.body.comment,
        createdAt: now
      })
      .returning();
    res.status(201).json({
      review: {
        id: row.id,
        productId: row.productId,
        userId: row.userId,
        name: row.userName,
        rating: row.rating,
        comment: row.comment,
        createdAt: row.createdAt
      }
    });
  })
);

export default router;
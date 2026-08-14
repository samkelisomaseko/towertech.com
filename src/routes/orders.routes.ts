import { Router } from "express";
import { z } from "zod";
import { asyncHandler, NotFoundError } from "../lib/http.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { requireAdmin, requireAuth, optionalAuth } from "../middleware/auth.js";
import { createOrder, getOrderById, listAllOrders, listOrdersForUser, updateOrderStatus } from "../services/order.service.js";
import { processAiIntent } from "../services/ai.service.js";

const router = Router();

const orderParam = z.object({ id: z.string().min(1) });

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive()
      })
    )
    .min(1, "Cart is empty."),
  couponCode: z.string().optional(),
  shipping: z.object({
    name: z.string().min(1, "Full name is required."),
    email: z.string().email("Valid email required."),
    phone: z.string().min(5, "Phone number required."),
    address: z.string().min(1, "Address is required."),
    city: z.string().min(1, "City is required.")
  }),
  paymentMethod: z.enum(["card", "momo", "instacash"]),
  paymentNumber: z.string().optional()
});

router.post(
  "/",
  optionalAuth,
  validateBody(orderSchema),
  asyncHandler(async (req, res) => {
    const isGuest = !req.user;
    const result = await createOrder({
      items: req.body.items,
      couponCode: req.body.couponCode,
      shipping: req.body.shipping,
      paymentMethod: req.body.paymentMethod,
      paymentNumber: req.body.paymentNumber,
      userId: req.user?.sub,
      isGuest
    });
    res.status(201).json(result);
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const orders = await listOrdersForUser(req.user!.sub);
    res.json({ orders });
  })
);

router.get(
  "/all",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ orders: await listAllOrders() });
  })
);

router.get(
  "/:id",
  requireAuth,
  validateParams(orderParam),
  asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.id);
    if (!order) throw new NotFoundError("Order");
    if (req.user!.role !== "admin" && order.userId !== req.user!.sub) {
      res.status(403).json({ error: "You do not have access to this order.", code: "FORBIDDEN" });
      return;
    }
    res.json({ order });
  })
);

router.patch(
  "/:id/status",
  requireAdmin,
  validateParams(orderParam),
  validateBody(z.object({ status: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    res.json({ order: await updateOrderStatus(req.params.id, req.body.status) });
  })
);

router.post(
  "/:id/ai",
  requireAuth,
  validateParams(orderParam),
  validateBody(z.object({ message: z.string().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    res.json({ reply: await processAiIntent(req.body.message, {}) });
  })
);

export default router;
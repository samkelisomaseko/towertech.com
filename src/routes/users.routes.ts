import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { users, notifications } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { findByEmail } from "../services/auth.service.js";

const router = Router();

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(users).orderBy(users.createdAt);
    res.json({
      users: rows.map((u) => ({
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt
      }))
    });
  })
);

const statusSchema = z.object({ status: z.enum(["active", "banned"]) });

router.patch(
  "/:email/status",
  requireAdmin,
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    const user = await findByEmail(req.params.email);
    if (!user) {
      res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
      return;
    }
    if (user.role === "admin" && req.body.status === "banned") {
      res.status(400).json({ error: "Cannot ban an admin account.", code: "BAD_REQUEST" });
      return;
    }
    const [row] = await db
      .update(users)
      .set({ status: req.body.status, updatedAt: new Date() })
      .where(eq(users.email, user.email))
      .returning();
    res.json({
      user: { email: row.email, name: row.name, role: row.role, status: row.status, createdAt: row.createdAt }
    });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(notifications).where(eq(notifications.userId, req.user!.sub)).orderBy(desc(notifications.createdAt));
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        userId: n.userId,
        type: n.title,
        message: n.msg,
        read: n.read,
        createdAt: n.createdAt
      }))
    });
  })
);

router.post(
  "/notifications/mark-read",
  requireAuth,
  asyncHandler(async (req, res) => {
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, req.user!.sub));
    res.json({ ok: true });
  })
);

export default router;
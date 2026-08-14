import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { contactLimiter } from "../middleware/rateLimit.js";
import { logger } from "../lib/logger.js";
import { sendContactNotification } from "../services/email.service.js";
import { db } from "../db/index.js";
import { logs } from "../db/schema.js";
import { env } from "../config.js";

const router = Router();

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  message: z.string().min(1).max(2000)
});

const bugSchema = z.object({
  email: z.string().email(),
  message: z.string().min(1).max(4000),
  page: z.string().optional().default("unknown")
});

router.post(
  "/contact",
  contactLimiter,
  validateBody(contactSchema),
  asyncHandler(async (req, res) => {
    await db.insert(logs).values({
      level: "info",
      message: `Contact from ${req.body.name} <${req.body.email}>: ${req.body.message}`,
      createdAt: new Date()
    });
    void sendContactNotification(env.NOTIFY_CONTACT_EMAIL, "contact", req.body.message).catch(() => undefined);
    logger.info({ email: req.body.email }, "Contact message received");
    res.status(201).json({ ok: true, message: "Message received. Our team will respond within 24 hours." });
  })
);

router.post(
  "/bugs",
  contactLimiter,
  validateBody(bugSchema),
  asyncHandler(async (req, res) => {
    await db.insert(logs).values({
      level: "error",
      message: `Bug report (${req.body.page}) from ${req.body.email}: ${req.body.message}`,
      createdAt: new Date()
    });
    void sendContactNotification(env.NOTIFY_BUGS_EMAIL, "bug", req.body.message).catch(() => undefined);
    logger.warn({ email: req.body.email, page: req.body.page }, "Bug report received");
    res.status(201).json({ ok: true, message: "Bug report received. Thank you for helping improve TowerTech." });
  })
);

export default router;
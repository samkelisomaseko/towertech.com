import { Response, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { requireAuth, SESSION_COOKIE } from "../middleware/auth.js";
import { login, register, getSessionUser } from "../services/auth.service.js";
import { env } from "../config.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters.").max(100),
  email: z.string().email("Invalid email format."),
  password: z.string().min(6, "Password must be at least 6 characters.").max(128)
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format."),
  password: z.string().min(1, "Password is required.")
});

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

router.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { user } = await register(req.body);
    res.status(201).json({ user });
  })
);

router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, session } = await login(req.body);
    setSessionCookie(res, session);
    res.json({ user });
  })
);

router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAMESITE,
      path: "/"
    });
    res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getSessionUser(req.user!.sub);
    if (!user) {
      res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: env.COOKIE_SAMESITE,
        path: "/"
      });
      res.status(401).json({ error: "Session expired.", code: "SESSION_EXPIRED" });
      return;
    }
    res.json({ user });
  })
);

export default router;

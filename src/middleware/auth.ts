import { NextFunction, Request, Response } from "express";
import { verifySession, SessionPayload } from "../lib/jwt.js";
import { ForbiddenError, UnauthorizedError } from "../lib/http.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export const SESSION_COOKIE = "tt_session";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = token ? verifySession(token) : null;
  if (!user) {
    next(new UnauthorizedError());
    return;
  }
  req.user = user;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = token ? verifySession(token) : null;
  if (user) req.user = user;
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.role !== "admin") {
    next(new ForbiddenError("Admin access required."));
    return;
  }
  next();
}

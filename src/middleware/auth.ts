import { NextFunction, Request, Response } from "express";
import { SessionPayload } from "../lib/jwt.js";
import { ForbiddenError, UnauthorizedError } from "../lib/http.js";
import { authorizeSession } from "../services/auth.service.js";

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
  if (typeof token !== "string" || !token) {
    next(new UnauthorizedError());
    return;
  }
  authorizeSession(token)
    .then((user) => {
      if (!user) {
        next(new UnauthorizedError());
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) {
    next();
    return;
  }
  authorizeSession(token)
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
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

import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fields?: Record<string, string[]>;

  constructor(status: number, message: string, code = "APP_ERROR", fields?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, `${resource} not found.`, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, message, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  public readonly fields?: Record<string, string[]>;

  constructor(fields?: Record<string, string[]>, message = "Invalid input.") {
    super(400, message, "VALIDATION_ERROR");
    this.fields = fields;
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export function asyncHandler(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Route not found." });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = [];
      fields[key].push(issue.message);
    }
    res.status(400).json({ error: "Invalid input.", code: "VALIDATION_ERROR", fields });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields });
    return;
  }

  logger.error({ err }, "[UnhandledError]");
  res.status(500).json({ error: "Internal server error.", code: "INTERNAL" });
}

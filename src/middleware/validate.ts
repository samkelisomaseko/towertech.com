import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "../lib/http.js";

/**
 * Validate request body against a Zod schema.
 * On failure, throws a 400 with a structured fields map (same shape the UI expects).
 */
export function validateBody(schema: z.ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError(flattenZod(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams(schema: z.ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError(flattenZod(result.error)));
      return;
    }
    next();
  };
}

export function validateQuery(schema: z.ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError(flattenZod(result.error)));
      return;
    }
    next();
  };
}

function flattenZod(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = [];
    fields[key].push(issue.message);
  }
  return fields;
}

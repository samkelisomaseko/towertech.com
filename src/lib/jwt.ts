import jwt from "jsonwebtoken";
import { env } from "../config.js";

export interface SessionPayload {
  sub: string; // user email
  name: string;
  role: "user" | "admin";
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "string" || !decoded.sub) return null;
    return decoded as unknown as SessionPayload;
  } catch {
    return null;
  }
}

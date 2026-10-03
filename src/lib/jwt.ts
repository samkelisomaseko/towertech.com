import jwt from "jsonwebtoken";
import { env } from "../config.js";

export interface SessionPayload {
  sub: string; // user email
  name: string;
  role: "user" | "admin";
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE
    });
    if (typeof decoded === "string" || !decoded.sub) return null;
    return decoded as unknown as SessionPayload;
  } catch {
    return null;
  }
}

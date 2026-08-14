import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, NewUser, User } from "../db/schema.js";
import { AppError, NotFoundError, UnauthorizedError } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { signSession, SessionPayload } from "../lib/jwt.js";

export function toPublicUser(u: User) {
  return { email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt };
}

export async function findByEmail(email: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return row;
}

export async function register(input: { name: string; email: string; password: string }): Promise<{ user: ReturnType<typeof toPublicUser> }> {
  const email = input.email.toLowerCase();
  const existing = await findByEmail(email);
  if (existing) throw new AppError(409, "Email already registered.", "EMAIL_EXISTS");

  const passwordHash = hashPassword(input.password);
  const now = new Date();
  const insert: NewUser = {
    email,
    name: input.name.trim(),
    passwordHash,
    salt: "",
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const [row] = await db.insert(users).values(insert).returning();
  return { user: toPublicUser(row) };
}

export async function login(input: { email: string; password: string }): Promise<{
  user: ReturnType<typeof toPublicUser>;
  session: string;
}> {
  const email = input.email.toLowerCase();
  const user = await findByEmail(email);
  if (!user) throw new UnauthorizedError("Invalid email or password.");
  if (user.status === "banned") throw new ForbiddenStatus("Access Denied: Banned ID");

  const ok = verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid email or password.");

  const payload: SessionPayload = { sub: user.email, name: user.name, role: user.role as "user" | "admin" };
  const session = signSession(payload);
  return { user: toPublicUser(user), session };
}

class ForbiddenStatus extends AppError {
  constructor(message: string) {
    super(403, message, "FORBIDDEN");
  }
}

export async function getSessionUser(email: string): Promise<ReturnType<typeof toPublicUser> | null> {
  const user = await findByEmail(email);
  if (!user || user.status === "banned") return null;
  return toPublicUser(user);
}

export { NotFoundError };

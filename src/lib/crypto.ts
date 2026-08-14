import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Scrypt-based password hashing (OWASP recommended). Format: scrypt$N$r$p$salt$hash
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nStr, rStr, pStr, salt, expectedHash] = parts;
    const n = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);
    const actual = scryptSync(password, salt, KEY_LEN, { N: n, r, p });
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Separate salt+hash form kept for future migration compatibility (e.g. future algorithms)
export function deriveCredentials(password: string): { salt: string; hash: string } {
  const stored = hashPassword(password);
  const parts = stored.split("$");
  return { salt: parts[4], hash: parts[5] };
}
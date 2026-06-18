import crypto from "node:crypto";

const HASH_PREFIX = "sha256";

export function randomId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [prefix, salt, hash] = storedHash.split(":");
  if (prefix !== HASH_PREFIX || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

export function hmac(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

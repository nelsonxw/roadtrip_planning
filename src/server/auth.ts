import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
export const SESSION_COOKIE = "rt_session";
const KEY_LENGTH = 64;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  await db.session.deleteMany({ where: { id: sha256(token) } });
}

/** Returns the signed-in user, or null. Session tokens are stored hashed, so a database leak does not expose live sessions. */
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return { id: session.user.id, email: session.user.email };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

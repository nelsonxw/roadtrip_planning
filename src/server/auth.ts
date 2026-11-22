import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/firestore";
import { findUserById } from "@/server/users";

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

const sessions = () => getDb().collection("sessions");

export async function createSession(userId: string, email?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await sessions().doc(sha256(token)).set({
    userId,
    ...(email ? { email } : {}),
    expiresAt,
    createdAt: new Date(),
  });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  await sessions().doc(sha256(token)).delete();
}

/** Returns the signed-in user, or null. Session tokens are stored hashed, so a database leak does not expose live sessions. */
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sessionRef = sessions().doc(sha256(token));
  const snap = await sessionRef.get();
  if (!snap.exists) return null;
  const { userId, email, expiresAt } = snap.data()!;
  if (expiresAt.toDate() < new Date()) {
    await sessionRef.delete();
    return null;
  }
  if (email && typeof email === "string") {
    return { id: userId, email };
  }
  const user = await findUserById(userId);
  return user ? { id: user.id, email: user.email } : null;
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

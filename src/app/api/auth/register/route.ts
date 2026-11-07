import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createSession, hashPassword, setSessionCookie } from "@/server/auth";
import { json, parseBody, publicRoute } from "@/server/api";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});

export const POST = publicRoute(async (request) => {
  const { email, password } = await parseBody(request, credentials);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new AppError(409, "email_taken", "An account with this email already exists. Try signing in.");
  const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user: { id: user.id, email: user.email } }, 201);
});

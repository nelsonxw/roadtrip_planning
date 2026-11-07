import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createSession, setSessionCookie, verifyPassword } from "@/server/auth";
import { json, parseBody, publicRoute } from "@/server/api";

const credentials = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1).max(200) });

export const POST = publicRoute(async (request) => {
  const { email, password } = await parseBody(request, credentials);
  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user: { id: user.id, email: user.email } });
});

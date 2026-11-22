import { z } from "zod";
import { createSession, hashPassword, setSessionCookie } from "@/server/auth";
import { json, parseBody, publicRoute } from "@/server/api";
import { createUser } from "@/server/users";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});

export const POST = publicRoute(async (request) => {
  const { email, password } = await parseBody(request, credentials);
  const user = await createUser(email, await hashPassword(password));
  const session = await createSession(user.id, user.email);
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user: { id: user.id, email: user.email } }, 201);
});

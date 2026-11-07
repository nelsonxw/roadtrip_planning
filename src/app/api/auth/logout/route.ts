import { cookies } from "next/headers";
import { clearSessionCookie, deleteSession, SESSION_COOKIE } from "@/server/auth";
import { json, publicRoute } from "@/server/api";

export const POST = publicRoute(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  await clearSessionCookie();
  return json({ ok: true });
});

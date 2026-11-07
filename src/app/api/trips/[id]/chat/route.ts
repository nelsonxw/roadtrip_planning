import { z } from "zod";
import { handleChatMessage, listChat } from "@/server/proposals";
import { authedRoute, json, parseBody } from "@/server/api";

export const GET = authedRoute<{ id: string }>(async (_request, user, { id }) => json({ messages: await listChat(id, user.id) }));

export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { message } = await parseBody(request, z.object({ message: z.string().trim().min(1).max(1000) }));
  return json({ messages: await handleChatMessage({ tripId: id, ownerId: user.id, message }) });
});

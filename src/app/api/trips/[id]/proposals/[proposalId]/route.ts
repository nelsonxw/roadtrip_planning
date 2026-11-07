import { z } from "zod";
import { acceptProposal, rejectProposal } from "@/server/proposals";
import { getTripView } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";
import { listChat } from "@/server/proposals";

const actionSchema = z.object({ action: z.enum(["accept", "reject"]), confirmRequired: z.boolean().default(false) });

export const POST = authedRoute<{ id: string; proposalId: string }>(async (request, user, { id, proposalId }) => {
  const { action, confirmRequired } = await parseBody(request, actionSchema);
  if (action === "accept") {
    await acceptProposal({ tripId: id, ownerId: user.id, proposalId, confirmRequired });
  } else {
    await rejectProposal({ tripId: id, ownerId: user.id, proposalId });
  }
  return json({ trip: await getTripView(id, user.id), messages: await listChat(id, user.id) });
});

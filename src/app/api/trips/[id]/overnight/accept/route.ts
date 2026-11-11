import { z } from "zod";
import { acceptOvernightSuggestion } from "@/server/overnightService";
import { authedRoute, json, parseBody } from "@/server/api";

const bodySchema = z.object({
  expectedVersion: z.number().int(),
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
});

/** Adds one suggested overnight stop, after the user accepts it. The trip version guards against stale suggestions. */
export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const input = await parseBody(request, bodySchema);
  return json(await acceptOvernightSuggestion({ tripId: id, ownerId: user.id, ...input }));
});

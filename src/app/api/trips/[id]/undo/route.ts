import { z } from "zod";
import { getTripView, undoLastChange } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { expectedVersion } = await parseBody(request, z.object({ expectedVersion: z.number().int() }));
  await undoLastChange({ tripId: id, ownerId: user.id, expectedVersion });
  return json(await getTripView(id, user.id));
});

import { findHotelsNearStop } from "@/server/tripService";
import { authedRoute, json } from "@/server/api";

export const GET = authedRoute<{ id: string; stopId: string }>(async (_request, user, { id, stopId }) => {
  return json(await findHotelsNearStop({ tripId: id, ownerId: user.id, stopId }));
});

import { discoverPlaces } from "@/server/tripService";
import { authedRoute, json } from "@/server/api";

export const POST = authedRoute<{ id: string }>(async (_request, user, { id }) => {
  return json(await discoverPlaces({ tripId: id, ownerId: user.id }));
});

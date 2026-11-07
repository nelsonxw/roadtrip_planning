import { z } from "zod";
import { getTripView, setPlaceStatus } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const bodySchema = z.object({ status: z.enum(["suggested", "saved", "dismissed"]) });

export const PATCH = authedRoute<{ id: string; placeId: string }>(async (request, user, { id, placeId }) => {
  const { status } = await parseBody(request, bodySchema);
  await setPlaceStatus({ tripId: id, ownerId: user.id, placeId, status });
  return json(await getTripView(id, user.id));
});

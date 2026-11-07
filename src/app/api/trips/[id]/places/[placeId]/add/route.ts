import { z } from "zod";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { applyTripChange, getTripView } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const bodySchema = z.object({ expectedVersion: z.number().int() });

/** Adds a discovered place to the itinerary as an optional stop. The stop is linked back to the recommendation. */
export const POST = authedRoute<{ id: string; placeId: string }>(async (request, user, { id, placeId }) => {
  const { expectedVersion } = await parseBody(request, bodySchema);
  const place = await db.placeRecommendation.findFirst({ where: { id: placeId, trip: { id, ownerId: user.id } } });
  if (!place) throw new AppError(404, "place_not_found", "That recommendation no longer exists.");
  if (place.stopId) throw new AppError(409, "already_added", "This place is already in the itinerary.");
  await applyTripChange({
    tripId: id,
    ownerId: user.id,
    expectedVersion,
    summary: `Added ${place.name} from recommendations`,
    operations: [
      {
        type: "add_stop",
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        stopType: "optional",
        source: "poi",
        notes: "",
        visitMinutes: place.visitMinutes,
        placeId: place.id,
      },
    ],
  });
  return json(await getTripView(id, user.id));
});

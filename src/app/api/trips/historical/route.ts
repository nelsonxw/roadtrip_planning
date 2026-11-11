import { z } from "zod";
import { countHistoricalTrips, deleteHistoricalTrips } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

export const GET = authedRoute(async (_request, user) => json({ count: await countHistoricalTrips(user.id) }));

/** Deletes past trips only if the count still matches what the user confirmed. */
export const DELETE = authedRoute(async (request, user) => {
  const { expectedCount } = await parseBody(request, z.object({ expectedCount: z.number().int().min(0) }));
  const deleted = await deleteHistoricalTrips(user.id, expectedCount);
  return json({ deleted });
});

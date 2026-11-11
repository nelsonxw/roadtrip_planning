import { z } from "zod";
import { deleteTripsByIds } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const bulkSchema = z.object({ ids: z.array(z.string().min(1)).min(1, "Select at least one trip.").max(200) });

/** Deletes the selected trips. Only the signed-in user's trips can be removed. */
export const DELETE = authedRoute(async (request, user) => {
  const { ids } = await parseBody(request, bulkSchema);
  const deleted = await deleteTripsByIds(user.id, ids);
  return json({ deleted });
});

import { z } from "zod";
import { MAX_PREVIEW_POINTS, previewRouteThrough } from "@/server/overnightRoute";
import { authedRoute, json, parseBody } from "@/server/api";

const bodySchema = z.object({
  points: z.array(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })).max(MAX_PREVIEW_POINTS),
});

/** Route geometry through the suggested overnight towns. Read-only: nothing is saved. */
export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { points } = await parseBody(request, bodySchema);
  const result = await previewRouteThrough(id, user.id, points.map((p) => [p.longitude, p.latitude]));
  return json(result);
});

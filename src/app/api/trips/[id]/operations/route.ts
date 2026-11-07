import { z } from "zod";
import { tripOperationSchema } from "@/domain/trip";
import { applyTripChange, getTripView } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const bodySchema = z.object({
  expectedVersion: z.number().int(),
  operations: z.array(tripOperationSchema).min(1).max(50),
  summary: z.string().trim().min(1).max(300).default("Updated trip"),
});

/** Applies user-initiated operations. The AI assistant uses the same operations via accepted proposals. */
export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { expectedVersion, operations, summary } = await parseBody(request, bodySchema);
  await applyTripChange({ tripId: id, ownerId: user.id, expectedVersion, operations, summary });
  return json(await getTripView(id, user.id));
});

import { z } from "zod";
import { deleteTrip, getTripView, updateTripDetails } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const updateSchema = z.object({
  expectedVersion: z.number().int(),
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationDays: z.number().int().min(1).max(60).nullable().optional(),
});

export const GET = authedRoute<{ id: string }>(async (_request, user, { id }) => json(await getTripView(id, user.id)));

export const PATCH = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { expectedVersion, ...changes } = await parseBody(request, updateSchema);
  await updateTripDetails({ tripId: id, ownerId: user.id, expectedVersion, ...changes });
  return json(await getTripView(id, user.id));
});

export const DELETE = authedRoute<{ id: string }>(async (_request, user, { id }) => {
  await deleteTrip(id, user.id);
  return json({ ok: true });
});

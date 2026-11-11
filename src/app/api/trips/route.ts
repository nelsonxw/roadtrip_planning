import { z } from "zod";
import { createTrip, listTripsForOwner } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const endpoint = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().max(300).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the trip a name.").max(120),
  notes: z.string().max(2000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationDays: z.number().int().min(1).max(60).nullable().optional(),
  roundTrip: z.boolean().default(false),
  origin: endpoint,
  destination: endpoint,
});

export const GET = authedRoute(async (_request, user) => json({ trips: await listTripsForOwner(user.id) }));

export const POST = authedRoute(async (request, user) => {
  const input = await parseBody(request, createSchema);
  const id = await createTrip(user.id, input);
  return json({ id }, 201);
});

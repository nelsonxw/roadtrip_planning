import { planOvernightStops } from "@/server/overnightService";
import { authedRoute, json } from "@/server/api";

/** Suggested overnight stops for a long trip. Read-only: nothing is added until the user accepts one. */
export const GET = authedRoute<{ id: string }>(async (_request, user, { id }) => json(await planOvernightStops(id, user.id)));

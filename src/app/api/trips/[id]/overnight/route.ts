import { MIN_POPULATION_OPTIONS, DEFAULT_MIN_POPULATION } from "@/domain/overnight";
import { planOvernightStops } from "@/server/overnightService";
import { authedRoute, json } from "@/server/api";

/** Suggested overnight stops for a long trip. Read-only: nothing is added until the user accepts one. */
export const GET = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const requested = Number(new URL(request.url).searchParams.get("minPopulation"));
  const minPopulation = (MIN_POPULATION_OPTIONS as readonly number[]).includes(requested) ? requested : DEFAULT_MIN_POPULATION;
  return json(await planOvernightStops(id, user.id, undefined, minPopulation));
});

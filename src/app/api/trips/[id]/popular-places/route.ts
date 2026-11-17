import { getServices } from "@/services/providers";
import { getTripView } from "@/server/tripService";
import { findPopularPlaces } from "@/server/popularPlaces";
import { authedRoute, json } from "@/server/api";

/** AI-suggested popular places within 50 miles of the route and stops, each confirmed on Wikidata. */
export const GET = authedRoute<{ id: string }>(async (_request, user, { id }) => {
  const services = getServices();
  const view = await getTripView(id, user.id, services);
  return json(await findPopularPlaces(view, services));
});

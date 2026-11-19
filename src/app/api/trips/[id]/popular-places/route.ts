import { getServices } from "@/services/providers";
import { getTripView } from "@/server/tripService";
import { findPopularPlaces } from "@/server/popularPlaces";
import { authedRoute, json } from "@/server/api";

/** AI-suggested popular places along the route, each confirmed on Wikidata. `includeEndpoints=true` keeps places near the origin and end too. */
export const GET = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const includeEndpoints = new URL(request.url).searchParams.get("includeEndpoints") === "true";
  const services = getServices();
  const view = await getTripView(id, user.id, services);
  return json(await findPopularPlaces(view, services, includeEndpoints));
});

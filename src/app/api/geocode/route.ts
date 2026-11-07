import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getServices } from "@/services/providers";
import { authedRoute, json } from "@/server/api";

const querySchema = z.object({ q: z.string().trim().min(2).max(120) });

/** Place autocomplete. Results carry coordinates so the user picks a location instead of the server guessing one. */
export const GET = authedRoute(async (request) => {
  const parsed = querySchema.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
  if (!parsed.success) throw new AppError(422, "query_too_short", "Type at least 2 characters to search.");
  const services = getServices();
  const results = await services.geocoding.search(parsed.data.q, 6);
  return json({ results, mode: services.modes.geocoding, provider: services.geocoding.provider });
});

import { z } from "zod";
import { distanceToLineMeters, haversineMeters, sampleLine, type LngLat } from "@/domain/geo";
import type { Stop } from "@/domain/trip";
import { TtlCache } from "@/lib/cache";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import { generateJsonText } from "@/services/assistant/gemini";
import type { Services } from "@/services/providers";
import type { SettlementCandidate } from "@/services/types";
import { normalizeName, titleMatchesPlace } from "@/services/places/names";
import type { TripView } from "./tripService";

const METERS_PER_MILE = 1609.344;
/** Suggestions further than this from the driving route or the stops are dropped, whatever the model said. */
export const MAX_DISTANCE_METERS = 50 * METERS_PER_MILE;
const SUGGESTIONS_REQUESTED = 12;
const VERIFY_AT_ONCE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const PROVIDER = "Wikidata";
/** Wikidata rejects generic agents with HTTP 429 and asks for a descriptive agent with a contact link. */
export const WIKIDATA_USER_AGENT = "RoadTripAI/0.1 (https://github.com/nelsonxw/roadtrip_planning)";

const cache = new TtlCache<PopularPlacesResult>(DAY_MS, 100);
type WikidataPlace = { id: string; latitude: number; longitude: number; wikipediaTitle: string | null };
const entityCache = new TtlCache<WikidataPlace | null>(WEEK_MS, 500);

export function clearPopularPlacesCache(): void {
  cache.clear();
  entityCache.clear();
}

const suggestionSchema = z.object({
  places: z
    .array(z.object({ name: z.string().trim().min(2).max(120), type: z.string().trim().max(60).default(""), reason: z.string().trim().max(200).default("") }))
    .max(SUGGESTIONS_REQUESTED),
});

export type PopularPlace = {
  name: string;
  type: string;
  reason: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  wikidataUrl: string;
  /** Brief Wikipedia summary, or an empty string when the article has none. */
  extract: string;
  /** Link to the full Wikipedia article, or null when the place has no English article. */
  wikipediaUrl: string | null;
};

const SUMMARY_CHARACTERS = 400;

/** The first sentences of a summary, cut at a sentence end where possible, so a popup stays brief. */
export function briefExtract(text: string, max = SUMMARY_CHARACTERS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > max / 2 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
}

type WikipediaSummary = { extract?: string; content_urls?: { desktop?: { page?: string } } };

async function wikipediaSummary(title: string, userAgent: string): Promise<WikipediaSummary | null> {
  return fetchProviderJson<WikipediaSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, {
    provider: "Wikipedia",
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    timeoutMs: 8000,
    retries: 0,
  }).catch(() => null);
}

export type PopularPlacesResult = { status: "ok" | "unavailable"; places: PopularPlace[]; note: string };

const BUSY_NOTE = "Google Gemini is busy right now, so suggestions could not be made. This is usually temporary. Wait a moment and press Try again.";

const SYSTEM_INSTRUCTION = [
  "You suggest popular places for a road trip.",
  "Only suggest places you are confident exist and are well known: parks, landmarks, museums, historic sites, mountains, and attractions.",
  "Every suggestion must be within 50 miles of the driving route or of one of the listed stops. Do not suggest anything farther away.",
  "Use the towns near the route and the route path to find places along the way, not only places near the stops.",
  "Leave out hotels, restaurants, shops, and small businesses. Do not invent names.",
  `Reply only with JSON: {"places":[{"name": string, "type": string, "reason": string}]} with at most ${SUGGESTIONS_REQUESTED} items, most popular first. The reason is one short sentence.`,
].join(" ");

/** Route context sent to the model: the towns the route passes through, and a few points along its path. */
export type RouteContext = { towns: string[]; path: LngLat[] };
const PATH_POINTS = 30;
const TOWN_LIMIT = 40;
const TOWN_BUFFER_METERS = 50 * METERS_PER_MILE;
/** Long routes have many towns; the search must return enough of them that every stretch of the route is covered. */
const TOWN_SEARCH_LIMIT = 500;
const TOWN_RANK: Record<SettlementCandidate["kind"], number> = { city: 0, town: 1, village: 2 };

/** The model is told the stops, the route context, and the 50-mile rule. Coordinates are never taken from the model. */
export function buildPrompt(view: TripView, context: RouteContext = { towns: [], path: [] }, includeEndpoints = true): string {
  const stops = view.stops.map((stop) => `- ${stop.name} (${stop.stopType}) at ${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`).join("\n");
  const towns = context.towns.length ? `\nTowns near the route:\n${context.towns.map((town) => `- ${town}`).join("\n")}` : "";
  const path = context.path.length ? `\nRoute path (lat, lon), in order:\n${context.path.map(([lon, lat]) => `- ${lat.toFixed(3)}, ${lon.toFixed(3)}`).join("\n")}` : "";
  const skipEnds = includeEndpoints ? "" : "\nDo not suggest places within 50 miles of the origin or the return point.";
  return `Trip: ${view.name}\nStops in order:\n${stops}${towns}${path}\nSuggest up to ${SUGGESTIONS_REQUESTED} popular places within 50 miles of this route or these stops.${skipEnds}`;
}

/** Drops places within 50 miles of the origin or the return point. The destination and other stops do not count. */
export function excludeNearEndpoints<T extends { latitude: number; longitude: number }>(places: T[], stops: Stop[]): T[] {
  const endpoints = stops.filter((stop) => stop.stopType === "origin" || stop.stopType === "return");
  return places.filter((place) => endpoints.every((stop) => haversineMeters([stop.longitude, stop.latitude], [place.longitude, place.latitude]) > MAX_DISTANCE_METERS));
}

/**
 * Towns within 50 miles of the route, from the places provider. Cities come first, then nearer places,
 * so the limit keeps the places most likely to hold attractions. A failure leaves the towns out rather than stopping the search.
 */
export async function routeContext(view: TripView, services: Services): Promise<RouteContext> {
  const path = sampleLine(view.routeGeometry, PATH_POINTS);
  const found = services.places.searchSettlements ? await services.places.searchSettlements(view.routeGeometry, TOWN_BUFFER_METERS, TOWN_SEARCH_LIMIT).catch(() => []) : [];
  const vertices = sampleLine(view.routeGeometry, 600);
  const ranked = found
    .map((town) => ({ town, meters: distanceToLineMeters([town.longitude, town.latitude], vertices) }))
    .sort((a, b) => TOWN_RANK[a.town.kind] - TOWN_RANK[b.town.kind] || a.meters - b.meters);
  const names = [...new Set(ranked.map(({ town }) => (town.region ? `${town.name}, ${town.region}` : town.name)))].slice(0, TOWN_LIMIT);
  return { towns: names, path };
}

/** Parses the model's JSON answer. Anything that is not the expected shape is rejected rather than shown. */
export function parseSuggestions(text: string): z.infer<typeof suggestionSchema>["places"] {
  // Models sometimes wrap the JSON in a code fence or add a sentence around it, so take the outermost object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let json: unknown;
  try {
    json = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    // Logged so an unreadable reply can be diagnosed; the user only sees the generic message.
    console.error(`Popular places: reply was not JSON (${text.length} chars): ${JSON.stringify(text.slice(0, 500))}`);
    throw new ProviderError("Google Gemini", "invalid_response", "The suggestions could not be read. Try again.");
  }
  const parsed = suggestionSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError("Google Gemini", "invalid_response", "The suggestions were not in the expected form. Try again.");
  return parsed.data.places;
}

type WikidataEntity = {
  labels?: { en?: { value: string } };
  sitelinks?: { enwiki?: { title: string } };
  claims?: { P625?: { mainsnak?: { datavalue?: { value?: { latitude: number; longitude: number } } } }[] };
};

async function wikidata<T>(params: URLSearchParams, userAgent: string): Promise<T | null> {
  // A Wikidata outage leaves the suggestion unverified, so it is dropped rather than shown unchecked.
  return fetchProviderJson<T>(`${WIKIDATA_API}?${params}`, {
    provider: PROVIDER,
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    timeoutMs: 8000,
    retries: 0,
  }).catch(() => null);
}

/** Finds the Wikidata item for a suggested name that has coordinates close to the route. Null when none matches. */
export async function verifySuggestion(
  name: string,
  routeVertices: LngLat[],
  userAgent: string,
): Promise<{ id: string; latitude: number; longitude: number; distanceMeters: number; wikipediaTitle: string | null } | null> {
  const normKey = normalizeName(name);
  let place = entityCache.get(normKey);

  if (place === undefined) {
    const search = await wikidata<{ search?: { id: string; match?: { text?: string } }[] }>(
      new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", type: "item", limit: "3", format: "json" }),
      userAgent,
    );
    const items = search?.search ?? [];
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      entityCache.set(normKey, null);
      return null;
    }
    // Wikidata often labels a park shortly ("Palo Duro State Park") and keeps the full name as an alias, so a search match on the alias counts too.
    const aliasMatch = new Set(items.filter((item) => item.match?.text && normalizeName(item.match.text) === normKey).map((item) => item.id));
    const entities = await wikidata<{ entities?: Record<string, WikidataEntity> }>(
      new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "labels|claims|sitelinks", languages: "en", format: "json" }),
      userAgent,
    );
    place = null;
    for (const id of ids) {
      const entity = entities?.entities?.[id];
      const label = entity?.labels?.en?.value;
      const coordinate = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (!label || !coordinate || !(aliasMatch.has(id) || titleMatchesPlace(name, label))) continue;
      place = { id, latitude: coordinate.latitude, longitude: coordinate.longitude, wikipediaTitle: entity?.sitelinks?.enwiki?.title ?? null };
      break;
    }
    entityCache.set(normKey, place);
  }

  if (!place) return null;
  const distanceMeters = distanceToLineMeters([place.longitude, place.latitude], routeVertices);
  if (distanceMeters <= MAX_DISTANCE_METERS) {
    return { ...place, distanceMeters };
  }
  return null;
}

/**
 * Asks the model for popular places, then keeps only the ones Wikidata confirms within 50 miles.
 * `fresh` skips the saved result and asks the model again. The new result is still saved for later reloads.
 */
export async function findPopularPlaces(view: TripView, services: Services, includeEndpoints: boolean, fresh = false, userAgent = WIKIDATA_USER_AGENT): Promise<PopularPlacesResult> {
  if (!services.assistantConfig) return { status: "unavailable", places: [], note: "Popular place suggestions need a Gemini key (GEMINI_API_KEY)." };
  if (view.routeGeometry.length < 2) return { status: "ok", places: [], note: "Calculate a route before asking for popular places." };

  const key = JSON.stringify({ id: view.id, stops: view.stops.map((stop) => [stop.id, stop.latitude, stop.longitude]), route: view.routeGeometry.length, includeEndpoints });
  const cached = fresh ? undefined : cache.get(key);
  if (cached) return cached;

  const { apiKey, model } = services.assistantConfig;
  let text: string;
  try {
    text = await generateJsonText(apiKey, model, SYSTEM_INSTRUCTION, buildPrompt(view, await routeContext(view, services), includeEndpoints));
  } catch (error) {
    // A busy model is temporary, so say so and leave the result uncached so the user can retry.
    if (error instanceof ProviderError && error.kind === "unavailable") return { status: "unavailable", places: [], note: BUSY_NOTE };
    throw error;
  }
  const suggestions = parseSuggestions(text);
  const vertices = sampleLine(view.routeGeometry, 600);

  const places: (PopularPlace & { wikipediaTitle: string | null })[] = [];
  for (let i = 0; i < suggestions.length; i += VERIFY_AT_ONCE) {
    const batch = suggestions.slice(i, i + VERIFY_AT_ONCE);
    const verified = await Promise.all(batch.map((item) => verifySuggestion(item.name, vertices, userAgent)));
    verified.forEach((match, index) => {
      if (!match) return;
      const item = batch[index];
      places.push({
        name: item.name,
        type: item.type,
        reason: item.reason,
        latitude: match.latitude,
        longitude: match.longitude,
        distanceMiles: Math.round((match.distanceMeters / METERS_PER_MILE) * 10) / 10,
        wikidataUrl: `https://www.wikidata.org/wiki/${match.id}`,
        extract: "",
        wikipediaUrl: null,
        wikipediaTitle: match.wikipediaTitle,
      });
    });
  }

  // A missing article leaves the summary empty; the place itself is still shown.
  const kept = includeEndpoints ? places : excludeNearEndpoints(places, view.stops);
  const withSummaries: PopularPlace[] = await Promise.all(
    kept.map(async ({ wikipediaTitle, ...place }) => {
      const summary = wikipediaTitle ? await wikipediaSummary(wikipediaTitle, userAgent) : null;
      return { ...place, extract: briefExtract(summary?.extract ?? ""), wikipediaUrl: summary?.content_urls?.desktop?.page ?? null };
    }),
  );

  const result: PopularPlacesResult = {
    status: "ok",
    places: withSummaries,
    note: withSummaries.length ? "Suggested by AI and checked against Wikidata. Opening hours and current status are not verified." : "No suggestions could be confirmed on Wikidata.",
  };
  cache.set(key, result);
  return result;
}

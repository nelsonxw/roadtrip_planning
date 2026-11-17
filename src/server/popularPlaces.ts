import { z } from "zod";
import { distanceToLineMeters, sampleLine, type LngLat } from "@/domain/geo";
import { TtlCache } from "@/lib/cache";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import { generateJsonText } from "@/services/assistant/gemini";
import type { Services } from "@/services/providers";
import { normalizeName, titleMatchesPlace } from "@/services/places/names";
import type { TripView } from "./tripService";

const METERS_PER_MILE = 1609.344;
/** Suggestions further than this from the driving route or the stops are dropped, whatever the model said. */
export const MAX_DISTANCE_METERS = 50 * METERS_PER_MILE;
const SUGGESTIONS_REQUESTED = 12;
const VERIFY_AT_ONCE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const PROVIDER = "Wikidata";
/** Wikidata rejects generic agents with HTTP 429 and asks for a descriptive agent with a contact link. */
export const WIKIDATA_USER_AGENT = "RoadTripAI/0.1 (https://github.com/nelsonxw/roadtrip_planning)";

const cache = new TtlCache<PopularPlacesResult>(DAY_MS, 100);

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

const SYSTEM_INSTRUCTION = [
  "You suggest popular places for a road trip.",
  "Only suggest places you are confident exist and are well known: parks, landmarks, museums, historic sites, mountains, and attractions.",
  "Every suggestion must be within 50 miles of the driving route or of one of the listed stops. Do not suggest anything farther away.",
  "Leave out hotels, restaurants, shops, and small businesses. Do not invent names.",
  `Reply only with JSON: {"places":[{"name": string, "type": string, "reason": string}]} with at most ${SUGGESTIONS_REQUESTED} items, most popular first. The reason is one short sentence.`,
].join(" ");

/** The model is told the stops and the 50-mile rule. Coordinates are never taken from the model. */
export function buildPrompt(view: TripView): string {
  const stops = view.stops.map((stop) => `- ${stop.name} (${stop.stopType}) at ${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`).join("\n");
  return `Trip: ${view.name}\nStops in order:\n${stops}\nSuggest up to ${SUGGESTIONS_REQUESTED} popular places within 50 miles of this route or these stops.`;
}

/** Parses the model's JSON answer. Anything that is not the expected shape is rejected rather than shown. */
export function parseSuggestions(text: string): z.infer<typeof suggestionSchema>["places"] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
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
  const search = await wikidata<{ search?: { id: string; match?: { text?: string } }[] }>(
    new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", type: "item", limit: "3", format: "json" }),
    userAgent,
  );
  const items = search?.search ?? [];
  const ids = items.map((item) => item.id);
  if (ids.length === 0) return null;
  // Wikidata often labels a park shortly ("Palo Duro State Park") and keeps the full name as an alias, so a search match on the alias counts too.
  const aliasMatch = new Set(items.filter((item) => item.match?.text && normalizeName(item.match.text) === normalizeName(name)).map((item) => item.id));
  const entities = await wikidata<{ entities?: Record<string, WikidataEntity> }>(
    new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "labels|claims|sitelinks", languages: "en", format: "json" }),
    userAgent,
  );
  for (const id of ids) {
    const entity = entities?.entities?.[id];
    const label = entity?.labels?.en?.value;
    const coordinate = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (!label || !coordinate || !(aliasMatch.has(id) || titleMatchesPlace(name, label))) continue;
    const distanceMeters = distanceToLineMeters([coordinate.longitude, coordinate.latitude], routeVertices);
    if (distanceMeters <= MAX_DISTANCE_METERS) {
      return { id, latitude: coordinate.latitude, longitude: coordinate.longitude, distanceMeters, wikipediaTitle: entity?.sitelinks?.enwiki?.title ?? null };
    }
  }
  return null;
}

/** Asks the model for popular places, then keeps only the ones Wikidata confirms within 50 miles. */
export async function findPopularPlaces(view: TripView, services: Services, userAgent = WIKIDATA_USER_AGENT): Promise<PopularPlacesResult> {
  if (!services.assistantConfig) return { status: "unavailable", places: [], note: "Popular place suggestions need a Gemini key (GEMINI_API_KEY)." };
  if (view.routeGeometry.length < 2) return { status: "ok", places: [], note: "Calculate a route before asking for popular places." };

  const key = JSON.stringify({ id: view.id, stops: view.stops.map((stop) => [stop.id, stop.latitude, stop.longitude]), route: view.routeGeometry.length });
  const cached = cache.get(key);
  if (cached) return cached;

  const { apiKey, model } = services.assistantConfig;
  const text = await generateJsonText(apiKey, model, SYSTEM_INSTRUCTION, buildPrompt(view));
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
  const withSummaries: PopularPlace[] = [];
  for (const { wikipediaTitle, ...place } of places) {
    const summary = wikipediaTitle ? await wikipediaSummary(wikipediaTitle, userAgent) : null;
    withSummaries.push({ ...place, extract: briefExtract(summary?.extract ?? ""), wikipediaUrl: summary?.content_urls?.desktop?.page ?? null });
  }

  const result: PopularPlacesResult = {
    status: "ok",
    places: withSummaries,
    note: withSummaries.length ? "Suggested by AI and checked against Wikidata. Opening hours and current status are not verified." : "No suggestions could be confirmed on Wikidata.",
  };
  cache.set(key, result);
  return result;
}

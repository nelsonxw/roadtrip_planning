import { distanceToLineMeters, haversineMeters, sampleLine, type LngLat } from "@/domain/geo";
import { TtlCache } from "@/lib/cache";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import type { PlaceCandidate, PlaceSearchOptions, PlacesService, SettlementCandidate } from "../types";

/** Geoapify place types for towns and cities. Population is not provided, so the type is the size signal. */
export const SETTLEMENT_CATEGORIES = ["populated_place.city", "populated_place.town", "populated_place.village"];

export function settlementKind(categories: string[]): "city" | "town" | "village" | null {
  if (categories.some((value) => value === "populated_place.city" || value.startsWith("populated_place.city."))) return "city";
  if (categories.some((value) => value === "populated_place.town" || value.startsWith("populated_place.town."))) return "town";
  if (categories.some((value) => value === "populated_place.village" || value.startsWith("populated_place.village."))) return "village";
  return null;
}

const BASE_URL = "https://api.geoapify.com/v2/places";
const PROVIDER = "Geoapify Places";
const ROUTE_POINTS = 150;
const VERTEX_SAMPLE = 600;
/** One search per roughly this many kilometres of route, so results spread along the whole trip. */
const KM_PER_SEGMENT = 150;
const MAX_SEGMENTS = 6;
/** Places this close to the start are not suggested; the user is already there. */
export const ORIGIN_EXCLUSION_METERS = 200000;

/** Category keys sent to Geoapify. Each one must exist in its supported-categories list. */
export const GEOAPIFY_CATEGORIES = [
  "tourism.attraction",
  "tourism.sights",
  "entertainment.museum",
  "leisure.park",
  "natural.protected_area",
  "natural.mountain.peak",
  "heritage",
];

type CategoryRule = { prefix: string; category: string; visitMinutes: number };

/** Order matters: the more specific prefix must come first. */
const CATEGORY_RULES: CategoryRule[] = [
  { prefix: "entertainment.museum", category: "Museum & art", visitMinutes: 90 },
  { prefix: "tourism.attraction.viewpoint", category: "Viewpoint", visitMinutes: 20 },
  { prefix: "tourism.attraction", category: "Attraction", visitMinutes: 60 },
  { prefix: "tourism.sights", category: "Historic site", visitMinutes: 45 },
  { prefix: "heritage", category: "Historic site", visitMinutes: 45 },
  { prefix: "leisure.park", category: "Park & nature", visitMinutes: 120 },
  { prefix: "natural.protected_area", category: "Park & nature", visitMinutes: 120 },
  { prefix: "natural", category: "Natural feature", visitMinutes: 60 },
];

export function categorize(categories: string[]): CategoryRule | null {
  return CATEGORY_RULES.find((rule) => categories.some((value) => value === rule.prefix || value.startsWith(`${rule.prefix}.`))) ?? null;
}

type GeoapifyFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    state?: string;
    lat?: number;
    lon?: number;
    formatted?: string;
    categories?: string[];
    place_id?: string;
    website?: string;
  };
};

/** Splits a route into consecutive pieces that share their boundary points, so no stretch is left unsearched. */
export function splitRoute(route: LngLat[], parts: number): LngLat[][] {
  if (parts <= 1 || route.length < 2) return [route];
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) cumulative.push(cumulative[i - 1] + haversineMeters(route[i - 1], route[i]));
  const total = cumulative[cumulative.length - 1];
  const segments: LngLat[][] = [];
  let start = 0;
  for (let part = 1; part <= parts; part++) {
    const target = (total * part) / parts;
    let end = start + 1;
    while (end < route.length - 1 && cumulative[end] < target) end++;
    segments.push(route.slice(start, end + 1));
    start = end;
  }
  // A one-point piece is not a line, so it is skipped rather than sent to the provider.
  return segments.filter((segment) => segment.length >= 2);
}

export function segmentCount(route: LngLat[]): number {
  let meters = 0;
  for (let i = 1; i < route.length; i++) meters += haversineMeters(route[i - 1], route[i]);
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(meters / 1000 / KM_PER_SEGMENT)));
}

/** Takes the best result from each list in turn, so no single list fills the whole result set. */
export function interleave<T>(lists: T[][], max: number): T[] {
  const out: T[] = [];
  for (let index = 0; out.length < max; index++) {
    let added = false;
    for (const list of lists) {
      if (index < list.length && out.length < max) {
        out.push(list[index]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export function buildRequestBody(route: LngLat[], options: PlaceSearchOptions) {
  return {
    categories: GEOAPIFY_CATEGORIES,
    filter: { type: "polyline", geometry: { type: "LineString", coordinates: sampleLine(route, ROUTE_POINTS) }, buffer: options.radiusMeters },
    limit: options.maxResults,
  };
}

/** Maps a Geoapify response to place candidates, nearest to the route first. Unnamed, uncategorised or far-off places are skipped. */
export function mapFeatures(features: GeoapifyFeature[], route: LngLat[], options: PlaceSearchOptions): PlaceCandidate[] {
  const routeVertices = sampleLine(route, VERTEX_SAMPLE);
  const seen = new Set<string>();
  const candidates: PlaceCandidate[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const latitude = props.lat ?? feature.geometry?.coordinates?.[1];
    const longitude = props.lon ?? feature.geometry?.coordinates?.[0];
    const rule = categorize(props.categories ?? []);
    if (!props.name || typeof latitude !== "number" || typeof longitude !== "number" || !rule) continue;
    if (options.categories?.length && !options.categories.includes(rule.category)) continue;
    const externalId = props.place_id ?? `${latitude},${longitude}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    candidates.push({
      externalId,
      name: props.name,
      category: rule.category,
      latitude,
      longitude,
      address: props.formatted ?? "",
      description: "",
      sourceUrl: props.website ?? null,
      image: null,
      detourDistanceMeters: Math.round(distanceToLineMeters([longitude, latitude], routeVertices)),
      visitMinutes: rule.visitMinutes,
      source: PROVIDER,
    });
  }
  return candidates.sort((a, b) => a.detourDistanceMeters - b.detourDistanceMeters).filter((c) => c.detourDistanceMeters <= options.radiusMeters);
}

/**
 * Places along the driving route from Geoapify (OpenStreetMap data). The route is searched in
 * segments and the results are spread across them. The key travels in a header. Descriptions
 * and photos are not provided by this source, so those fields stay empty.
 */
export class GeoapifyPlacesService implements PlacesService {
  readonly provider = PROVIDER;
  readonly mode = "live" as const;
  private readonly cache = new TtlCache<PlaceCandidate[]>(60 * 60 * 1000, 100);

  constructor(private readonly apiKey: string) {}

  /** Cities, towns and villages within the search radius of the route. Population is not returned, so place type is the size signal. */
  async searchSettlements(routeGeometry: LngLat[], radiusMeters: number): Promise<SettlementCandidate[]> {
    if (routeGeometry.length < 2) return [];
    const body = {
      categories: SETTLEMENT_CATEGORIES,
      filter: { type: "polyline", geometry: { type: "LineString", coordinates: sampleLine(routeGeometry, ROUTE_POINTS) }, buffer: radiusMeters },
      limit: 100,
    };
    const data = await fetchProviderJson<{ features?: GeoapifyFeature[] }>(BASE_URL, {
      provider: PROVIDER,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify(body),
      timeoutMs: 20000,
    });
    if (!Array.isArray(data.features)) throw new ProviderError(PROVIDER, "invalid_response", "The places provider returned an unexpected response.");
    const seen = new Set<string>();
    const settlements: SettlementCandidate[] = [];
    for (const feature of data.features) {
      const props = feature.properties ?? {};
      const latitude = props.lat ?? feature.geometry?.coordinates?.[1];
      const longitude = props.lon ?? feature.geometry?.coordinates?.[0];
      if (!props.name || !settlementKind(props.categories ?? []) || typeof latitude !== "number" || typeof longitude !== "number") continue;
      const externalId = props.place_id ?? `${latitude},${longitude}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      settlements.push({ externalId, name: props.name, region: props.state ?? null, latitude, longitude });
    }
    return settlements;
  }

  async searchAlongRoute(routeGeometry: LngLat[], options: PlaceSearchOptions): Promise<PlaceCandidate[]> {
    if (routeGeometry.length < 2) return [];
    const cacheKey = JSON.stringify({ route: sampleLine(routeGeometry, ROUTE_POINTS), radius: options.radiusMeters, max: options.maxResults, categories: options.categories });
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const segments = splitRoute(routeGeometry, segmentCount(routeGeometry));
    // Ask for more than needed per segment, because some results are filtered out afterwards.
    const perSegment = Math.max(5, Math.ceil((options.maxResults * 2) / segments.length));
    const origin = routeGeometry[0];
    const seen = new Set<string>();
    const lists: PlaceCandidate[][] = [];

    for (const segment of segments) {
      const body = buildRequestBody(segment, { ...options, maxResults: perSegment });
      const data = await fetchProviderJson<{ features?: GeoapifyFeature[] }>(BASE_URL, {
        provider: PROVIDER,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify(body),
        timeoutMs: 20000,
      });
      if (!Array.isArray(data.features)) throw new ProviderError(PROVIDER, "invalid_response", "The places provider returned an unexpected response.");
      const list = mapFeatures(data.features, routeGeometry, { ...options, maxResults: Number.MAX_SAFE_INTEGER })
        .filter((place) => haversineMeters(origin, [place.longitude, place.latitude]) > ORIGIN_EXCLUSION_METERS)
        .filter((place) => !seen.has(place.externalId));
      list.forEach((place) => seen.add(place.externalId));
      lists.push(list);
    }

    const places = interleave(lists, options.maxResults);
    this.cache.set(cacheKey, places);
    return places;
  }
}

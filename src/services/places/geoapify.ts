import { sampleLine, type LngLat } from "@/domain/geo";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import type { HotelCandidate, PlacesService, SettlementCandidate } from "../types";

const BASE_URL = "https://api.geoapify.com/v2/places";
const PROVIDER = "Geoapify Places";
const ROUTE_POINTS = 150;

/** Geoapify place types for towns and cities. Population is not provided, so the type is the size signal. */
export const SETTLEMENT_CATEGORIES = ["populated_place.city", "populated_place.town", "populated_place.village"];

export function settlementKind(categories: string[]): "city" | "town" | "village" | null {
  if (categories.some((value) => value === "populated_place.city" || value.startsWith("populated_place.city."))) return "city";
  if (categories.some((value) => value === "populated_place.town" || value.startsWith("populated_place.town."))) return "town";
  if (categories.some((value) => value === "populated_place.village" || value.startsWith("populated_place.village."))) return "village";
  return null;
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
  };
};

/**
 * Towns near the route, and hotels near a stop, from Geoapify (OpenStreetMap data).
 * The key travels in a header. Listings carry no availability or prices.
 */
export class GeoapifyPlacesService implements PlacesService {
  readonly provider = PROVIDER;
  readonly mode = "live" as const;

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

  /** Named hotels inside the radius, nearest to the centre first. Listings only: no availability or prices. */
  async searchHotels(center: LngLat, radiusMeters: number): Promise<HotelCandidate[]> {
    const [longitude, latitude] = center;
    const body = {
      categories: ["accommodation.hotel"],
      filter: { type: "circle", lon: longitude, lat: latitude, radius: radiusMeters },
      bias: { type: "proximity", lon: longitude, lat: latitude },
      limit: 20,
    };
    const data = await fetchProviderJson<{ features?: GeoapifyFeature[] }>(BASE_URL, {
      provider: PROVIDER,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify(body),
      timeoutMs: 20000,
    });
    if (!Array.isArray(data.features)) throw new ProviderError(PROVIDER, "invalid_response", "The places provider returned an unexpected response.");
    return data.features.flatMap((feature): HotelCandidate[] => {
      const props = feature.properties ?? {};
      const latitudeOf = props.lat ?? feature.geometry?.coordinates?.[1];
      const longitudeOf = props.lon ?? feature.geometry?.coordinates?.[0];
      if (!props.name || typeof latitudeOf !== "number" || typeof longitudeOf !== "number") return [];
      return [{ externalId: props.place_id ?? `${latitudeOf},${longitudeOf}`, name: props.name, address: props.formatted ?? "", latitude: latitudeOf, longitude: longitudeOf }];
    });
  }
}

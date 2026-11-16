import { TtlCache } from "@/lib/cache";
import { fetchProviderJson } from "@/lib/http";
import { ProviderError } from "@/lib/errors";
import type { GeocodeCandidate, GeocodingService } from "../types";

const BASE_URL = "https://api.geoapify.com/v1/geocode";
const PROVIDER = "Geoapify Geocoding";

type GeoapifyGeocodeResponse = {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: { name?: string; formatted?: string; lat?: number; lon?: number; rank?: { confidence?: number } };
  }[];
};

/** Geoapify geocoding. Unlike OpenRouteService it also finds points of interest such as ski resorts, parks and attractions. */
export class GeoapifyGeocoding implements GeocodingService {
  readonly provider = PROVIDER;
  readonly mode = "live" as const;
  private readonly cache = new TtlCache<GeocodeCandidate[]>(60 * 60 * 1000, 500);

  constructor(private readonly apiKey: string) {}

  search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.lookup("autocomplete", query, limit);
  }

  resolve(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.lookup("search", query, limit);
  }

  private async lookup(endpoint: "autocomplete" | "search", query: string, limit: number): Promise<GeocodeCandidate[]> {
    const key = `${endpoint}:${limit}:${query.trim().toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({ text: query, limit: String(limit), apiKey: this.apiKey });
    const data = await fetchProviderJson<GeoapifyGeocodeResponse>(`${BASE_URL}/${endpoint}?${params}`, {
      provider: PROVIDER,
      headers: { Accept: "application/json" },
      timeoutMs: 8000,
    });
    if (!Array.isArray(data.features)) throw new ProviderError(PROVIDER, "invalid_response", "The geocoding provider returned an unexpected response.");
    const results = data.features.flatMap((feature): GeocodeCandidate[] => {
      const props = feature.properties ?? {};
      const longitude = props.lon ?? feature.geometry?.coordinates?.[0];
      const latitude = props.lat ?? feature.geometry?.coordinates?.[1];
      if (typeof longitude !== "number" || typeof latitude !== "number") return [];
      const label = props.formatted ?? props.name ?? `${latitude}, ${longitude}`;
      return [{ label, name: props.name || label, latitude, longitude, confidence: props.rank?.confidence ?? null }];
    });
    this.cache.set(key, results);
    return results;
  }
}

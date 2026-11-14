import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import type { GeocodeCandidate, GeocodingService } from "../types";

const BASE_URL = "https://api.openrouteservice.org";

type ORSGeocodeResponse = {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: { label?: string; name?: string; confidence?: number };
  }[];
};

/** OpenRouteService (Pelias) place search, used for autocomplete and for resolving typed place names. */
export class OpenRouteServiceGeocoding implements GeocodingService {
  readonly provider = "OpenRouteService";
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.features("autocomplete", query, limit);
  }

  /** Full addresses with a house number only match the search endpoint. Autocomplete returns nothing for them. */
  resolve(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.features("search", query, limit);
  }

  private async features(endpoint: "autocomplete" | "search", query: string, limit: number): Promise<GeocodeCandidate[]> {
    const params = new URLSearchParams({ text: query, size: String(limit) });
    const data = await fetchProviderJson<ORSGeocodeResponse>(`${BASE_URL}/geocode/${endpoint}?${params}`, {
      provider: this.provider,
      headers: { Authorization: this.apiKey, Accept: "application/json" },
      timeoutMs: 8000,
    });
    if (!data.features) throw new ProviderError(this.provider, "invalid_response", "The geocoding provider returned an unexpected response.");
    return data.features.flatMap((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (typeof longitude !== "number" || typeof latitude !== "number") return [];
      return [
        {
          label: feature.properties?.label ?? feature.properties?.name ?? `${latitude}, ${longitude}`,
          name: feature.properties?.name ?? "",
          latitude,
          longitude,
          confidence: feature.properties?.confidence ?? null,
        },
      ];
    });
  }
}

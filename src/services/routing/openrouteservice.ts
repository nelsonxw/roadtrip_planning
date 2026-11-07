import type { LngLat } from "@/domain/geo";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import type { RouteLeg, RoutingOptions, RoutingService } from "../types";

const BASE_URL = "https://api.openrouteservice.org";

type ORSDirectionsResponse = {
  features?: {
    geometry?: { coordinates?: LngLat[] };
    properties?: { summary?: { distance?: number; duration?: number } };
  }[];
};

/** OpenRouteService driving directions. Supports fastest/shortest and avoid tolls/highways/ferries. Scenic routing is not supported. */
export class OpenRouteServiceRouting implements RoutingService {
  readonly provider = "OpenRouteService";
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async route(from: LngLat, to: LngLat, options: RoutingOptions): Promise<RouteLeg> {
    const body = {
      coordinates: [from, to],
      preference: options.preference,
      ...(options.avoid.length ? { options: { avoid_features: options.avoid } } : {}),
    };
    const data = await fetchProviderJson<ORSDirectionsResponse>(`${BASE_URL}/v2/directions/driving-car/geojson`, {
      provider: this.provider,
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/json", Accept: "application/geo+json" },
      body: JSON.stringify(body),
    });
    const feature = data.features?.[0];
    const summary = feature?.properties?.summary;
    const geometry = feature?.geometry?.coordinates;
    if (!summary || typeof summary.distance !== "number" || typeof summary.duration !== "number" || !geometry?.length) {
      throw new ProviderError(this.provider, "invalid_response", "The routing provider returned an incomplete route.");
    }
    return { distanceMeters: summary.distance, durationSeconds: summary.duration, geometry, provider: this.provider, mode: this.mode };
  }
}

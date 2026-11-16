import type { LngLat } from "@/domain/geo";
import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";
import type { RouteLeg, RoutingOptions, RoutingService } from "../types";

const BASE_URL = "https://api.geoapify.com/v1/routing";
const PROVIDER = "Geoapify Routing";

type GeoapifyRouteResponse = {
  features?: {
    geometry?: { type?: string; coordinates?: LngLat[] | LngLat[][] };
    properties?: { distance?: number; time?: number };
  }[];
};

/** The app's avoid options, named as Geoapify expects them. */
const AVOID_RULES: Record<RoutingOptions["avoid"][number], string> = { tollways: "tolls", highways: "highways", ferries: "ferries" };

/** Geoapify driving directions, used when the primary routing provider fails. Supports fastest/shortest and avoid tolls/highways/ferries. */
export class GeoapifyRouting implements RoutingService {
  readonly provider = PROVIDER;
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async route(from: LngLat, to: LngLat, options: RoutingOptions): Promise<RouteLeg> {
    // Geoapify takes latitude first, while the rest of the app uses longitude first.
    const params = new URLSearchParams({
      waypoints: `${from[1]},${from[0]}|${to[1]},${to[0]}`,
      mode: "drive",
      type: options.preference === "shortest" ? "short" : "balanced",
      apiKey: this.apiKey,
    });
    if (options.avoid.length) params.set("avoid", options.avoid.map((rule) => AVOID_RULES[rule]).join("|"));
    const data = await fetchProviderJson<GeoapifyRouteResponse>(`${BASE_URL}?${params}`, {
      provider: PROVIDER,
      headers: { Accept: "application/json" },
      timeoutMs: 20000,
    });
    const feature = data.features?.[0];
    const distance = feature?.properties?.distance;
    const duration = feature?.properties?.time;
    const raw = feature?.geometry?.coordinates ?? [];
    const geometry: LngLat[] = feature?.geometry?.type === "MultiLineString" ? (raw as LngLat[][]).flat() : (raw as LngLat[]);
    if (typeof distance !== "number" || typeof duration !== "number" || geometry.length === 0) {
      throw new ProviderError(PROVIDER, "invalid_response", "The routing provider returned an incomplete route.");
    }
    return { distanceMeters: distance, durationSeconds: duration, geometry, provider: PROVIDER, mode: this.mode };
  }
}

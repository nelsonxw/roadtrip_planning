import { env } from "@/lib/env";
import { DemoGeocoding, DemoRouting } from "./demo/demoServices";
import { OpenRouteServiceGeocoding } from "./geocoding/openrouteservice";
import { OverpassPlacesService } from "./places/overpass";
import { OpenRouteServiceRouting } from "./routing/openrouteservice";
import { WikimediaImageService } from "./images/wikimedia";
import type { GeocodingService, ImageService, PlacesService, RoutingService, ServiceMode } from "./types";

export type Services = {
  geocoding: GeocodingService;
  routing: RoutingService;
  places: PlacesService;
  images: ImageService;
  /** Reported in the UI so users always know whether results are live or demo data. */
  modes: { geocoding: ServiceMode; routing: ServiceMode; places: ServiceMode; assistant: ServiceMode };
};

/** Builds provider adapters from environment configuration. Keys are read on the server only. */
export function createServices(): Services {
  // Overpass and Wikimedia need no key, so places and images are live by default.
  const images = new WikimediaImageService(env.WIKIMEDIA_USER_AGENT);
  const routingKey = env.OPENROUTESERVICE_API_KEY;

  return {
    geocoding: routingKey ? new OpenRouteServiceGeocoding(routingKey) : new DemoGeocoding(),
    routing: routingKey ? new OpenRouteServiceRouting(routingKey) : new DemoRouting(),
    places: new OverpassPlacesService(env.OVERPASS_URL, images, env.WIKIMEDIA_USER_AGENT),
    images,
    modes: {
      geocoding: routingKey ? "live" : "demo",
      routing: routingKey ? "live" : "demo",
      places: "live",
      assistant: env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL ? "live" : "demo",
    },
  };
}

const globalForServices = globalThis as unknown as { services?: Services };

export function getServices(): Services {
  globalForServices.services ??= createServices();
  return globalForServices.services;
}

import { env } from "@/lib/env";
import { DemoGeocoding, DemoRouting } from "./demo/demoServices";
import { FallbackGeocoding } from "./geocoding/fallback";
import { GeoapifyGeocoding } from "./geocoding/geoapify";
import { OpenRouteServiceGeocoding } from "./geocoding/openrouteservice";
import { GeoapifyPlacesService } from "./places/geoapify";
import { OverpassPlacesService } from "./places/overpass";
import { FallbackRouting } from "./routing/fallback";
import { GeoapifyRouting } from "./routing/geoapify";
import { OpenRouteServiceRouting } from "./routing/openrouteservice";
import { WikimediaImageService } from "./images/wikimedia";
import type { GeocodingService, ImageService, PlacesService, RoutingService, ServiceMode } from "./types";

export type Services = {
  geocoding: GeocodingService;
  routing: RoutingService;
  places: PlacesService;
  images: ImageService;
  /** Null when no assistant key is set. The assistant then runs in demo mode. */
  assistantConfig: { apiKey: string; model: string } | null;
  /** Reported in the UI so users always know whether results are live or demo data. */
  modes: { geocoding: ServiceMode; routing: ServiceMode; places: ServiceMode; assistant: ServiceMode };
};

/** Geoapify first (it finds points of interest), OpenRouteService as the backup, demo data when neither key is set. */
function createGeocoding(): GeocodingService {
  const openRoute = env.OPENROUTESERVICE_API_KEY ? new OpenRouteServiceGeocoding(env.OPENROUTESERVICE_API_KEY) : null;
  if (env.GEOAPIFY_API_KEY) {
    const geoapify = new GeoapifyGeocoding(env.GEOAPIFY_API_KEY);
    return openRoute ? new FallbackGeocoding(geoapify, openRoute) : geoapify;
  }
  return openRoute ?? new DemoGeocoding();
}

/** OpenRouteService first, Geoapify as the backup, demo estimates when neither key is set. */
function createRouting(): RoutingService {
  const openRoute = env.OPENROUTESERVICE_API_KEY ? new OpenRouteServiceRouting(env.OPENROUTESERVICE_API_KEY) : null;
  if (env.GEOAPIFY_API_KEY) {
    const geoapify = new GeoapifyRouting(env.GEOAPIFY_API_KEY);
    return openRoute ? new FallbackRouting(openRoute, geoapify) : geoapify;
  }
  return openRoute ?? new DemoRouting();
}

/** Builds provider adapters from environment configuration. Keys are read on the server only. */
export function createServices(): Services {
  // Overpass and Wikimedia need no key, so places and images are live by default.
  const images = new WikimediaImageService(env.WIKIMEDIA_USER_AGENT);
  const assistantConfig = env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null;
  const geocoding = createGeocoding();
  const routing = createRouting();

  return {
    geocoding,
    routing,
    places: env.GEOAPIFY_API_KEY ? new GeoapifyPlacesService(env.GEOAPIFY_API_KEY) : new OverpassPlacesService(env.OVERPASS_URL, images, env.WIKIMEDIA_USER_AGENT),
    images,
    assistantConfig,
    modes: {
      geocoding: geocoding.mode,
      routing: routing.mode,
      places: "live",
      assistant: assistantConfig ? "live" : "demo",
    },
  };
}

const globalForServices = globalThis as unknown as { services?: Services };

export function getServices(): Services {
  globalForServices.services ??= createServices();
  return globalForServices.services;
}

import { haversineMeters, type LngLat } from "@/domain/geo";
import type {
  GeocodeCandidate,
  GeocodingService,
  ImageService,
  PlaceCandidate,
  PlaceSearchOptions,
  PlacesService,
  RouteLeg,
  RoutingService,
} from "../types";

/*
 * Demo providers are used only when API keys are missing or in automated tests.
 * Every result they return is marked as demo data. Nothing here is presented as live.
 */

const DEMO_GAZETTEER: { name: string; longitude: number; latitude: number }[] = [
  { name: "Austin, TX, USA", longitude: -97.7431, latitude: 30.2672 },
  { name: "Dallas, TX, USA", longitude: -96.797, latitude: 32.7767 },
  { name: "Oklahoma City, OK, USA", longitude: -97.5164, latitude: 35.4676 },
  { name: "Albuquerque, NM, USA", longitude: -106.6504, latitude: 35.0844 },
  { name: "Santa Fe, NM, USA", longitude: -105.9378, latitude: 35.687 },
  { name: "Denver, CO, USA", longitude: -104.9903, latitude: 39.7392 },
  { name: "Colorado Springs, CO, USA", longitude: -104.8214, latitude: 38.8339 },
  { name: "Moab, UT, USA", longitude: -109.5498, latitude: 38.5733 },
  { name: "Salt Lake City, UT, USA", longitude: -111.891, latitude: 40.7608 },
  { name: "Las Vegas, NV, USA", longitude: -115.1398, latitude: 36.1699 },
  { name: "Flagstaff, AZ, USA", longitude: -111.6513, latitude: 35.1983 },
  { name: "Phoenix, AZ, USA", longitude: -112.074, latitude: 33.4484 },
  { name: "Los Angeles, CA, USA", longitude: -118.2437, latitude: 34.0522 },
  { name: "San Francisco, CA, USA", longitude: -122.4194, latitude: 37.7749 },
  { name: "Seattle, WA, USA", longitude: -122.3321, latitude: 47.6062 },
  { name: "Portland, OR, USA", longitude: -122.6765, latitude: 45.5152 },
  { name: "Chicago, IL, USA", longitude: -87.6298, latitude: 41.8781 },
  { name: "Nashville, TN, USA", longitude: -86.7816, latitude: 36.1627 },
  { name: "Atlanta, GA, USA", longitude: -84.388, latitude: 33.749 },
  { name: "New York, NY, USA", longitude: -74.006, latitude: 40.7128 },
  { name: "Boston, MA, USA", longitude: -71.0589, latitude: 42.3601 },
];

const AVERAGE_DEMO_SPEED_MPS = 80_000 / 3600;
const ROAD_FACTOR = 1.25;

export class DemoGeocoding implements GeocodingService {
  readonly provider = "Demo gazetteer";
  readonly mode = "demo" as const;

  async search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return DEMO_GAZETTEER.filter((place) => place.name.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((place) => ({ label: `${place.name} (DEMO)`, name: place.name, latitude: place.latitude, longitude: place.longitude, confidence: null }));
  }
}

export class DemoRouting implements RoutingService {
  readonly provider = "Demo straight-line estimate";
  readonly mode = "demo" as const;

  async route(from: LngLat, to: LngLat): Promise<RouteLeg> {
    const straight = haversineMeters(from, to);
    const distanceMeters = straight * ROAD_FACTOR;
    const steps = 20;
    const geometry = Array.from({ length: steps + 1 }, (_, i): LngLat => [
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    ]);
    return { distanceMeters, durationSeconds: distanceMeters / AVERAGE_DEMO_SPEED_MPS, geometry, provider: this.provider, mode: this.mode };
  }
}

export class DemoPlaces implements PlacesService {
  readonly provider = "Demo placeholder places";
  readonly mode = "demo" as const;

  async searchAlongRoute(routeGeometry: LngLat[], options: PlaceSearchOptions): Promise<PlaceCandidate[]> {
    if (routeGeometry.length < 2) return [];
    const count = Math.min(options.maxResults, 4);
    return Array.from({ length: count }, (_, i): PlaceCandidate => {
      const [longitude, latitude] = routeGeometry[Math.floor(((i + 1) / (count + 1)) * (routeGeometry.length - 1))];
      return {
        externalId: `demo/${i + 1}`,
        name: `[DEMO] Sample viewpoint ${i + 1}`,
        category: "Viewpoint",
        latitude,
        longitude,
        address: "Demo location, not a real place",
        description: "Demo placeholder. Configure OPENROUTESERVICE_API_KEY and the places provider to see real results.",
        sourceUrl: null,
        image: null,
        detourDistanceMeters: 0,
        visitMinutes: 20,
        source: this.provider,
      };
    });
  }
}

export class DemoImages implements ImageService {
  readonly mode = "demo" as const;

  async findImageForUpload(): Promise<null> {
    return null;
  }
}

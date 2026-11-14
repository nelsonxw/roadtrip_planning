import type { LngLat } from "@/domain/geo";

/** "live" results come from a real provider. "demo" results are fixtures or estimates and are always labelled in the UI. */
export type ServiceMode = "live" | "demo";

export type GeocodeCandidate = {
  label: string;
  name: string;
  latitude: number;
  longitude: number;
  confidence: number | null;
};

export interface GeocodingService {
  readonly provider: string;
  readonly mode: ServiceMode;
  /** Autocomplete for a search box, which may be partial text. */
  search(query: string, limit: number): Promise<GeocodeCandidate[]>;
  /** Resolves a complete address to coordinates. */
  resolve(query: string, limit: number): Promise<GeocodeCandidate[]>;
}

export type RoutingOptions = {
  preference: "fastest" | "shortest";
  avoid: ("tollways" | "highways" | "ferries")[];
};

export type RouteLeg = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LngLat[];
  provider: string;
  mode: ServiceMode;
};

export interface RoutingService {
  readonly provider: string;
  readonly mode: ServiceMode;
  /** Routes between exactly two points. Callers build multi-stop routes from legs so provider waypoint limits never apply. */
  route(from: LngLat, to: LngLat, options: RoutingOptions): Promise<RouteLeg>;
}

export type PlaceCandidate = {
  externalId: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string;
  description: string;
  sourceUrl: string | null;
  image: ImageInfo | null;
  /** Straight-line distance from the place to the nearest point on the route. Not a driving detour. */
  detourDistanceMeters: number;
  /** Rough visit length from the category. Always an estimate. */
  visitMinutes: number | null;
  source: string;
};

export type PlaceSearchOptions = {
  radiusMeters: number;
  maxResults: number;
  categories?: string[];
};

export type SettlementCandidate = {
  externalId: string;
  name: string;
  /** State or region name, used to tell apart towns with the same name. */
  region: string | null;
  latitude: number;
  longitude: number;
};

/** A hotel from a directory listing. Room availability and prices are not known. */
export type HotelCandidate = { externalId: string; name: string; address: string; latitude: number; longitude: number };

export interface PlacesService {
  readonly provider: string;
  readonly mode: ServiceMode;
  searchAlongRoute(routeGeometry: LngLat[], options: PlaceSearchOptions): Promise<PlaceCandidate[]>;
  /** Cities, towns and villages near the route. Optional: not every provider can list settlements. */
  searchSettlements?(routeGeometry: LngLat[], radiusMeters: number): Promise<SettlementCandidate[]>;
  /** Hotels within a radius of a point, nearest first. Optional: only providers with accommodation data implement it. */
  searchHotels?(center: LngLat, radiusMeters: number): Promise<HotelCandidate[]>;
}

export type ImageInfo = {
  url: string;
  sourceUrl: string;
  attribution: string;
  license: string;
};

export interface ImageService {
  readonly mode: ServiceMode;
  /** Takes the upload URL of an image (for example from Wikipedia's summary) and returns it only when licence metadata is available. */
  findImageForUpload(uploadUrl: string): Promise<ImageInfo | null>;
}

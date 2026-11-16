import { afterEach, describe, expect, it, vi } from "vitest";
import { GeoapifyPlacesService } from "@/services/places/geoapify";
import { filterHotels } from "@/components/workspace/hotelSearch";
import { OpenRouteServiceGeocoding } from "@/services/geocoding/openrouteservice";
import { GeoapifyGeocoding } from "@/services/geocoding/geoapify";
import { FallbackGeocoding } from "@/services/geocoding/fallback";
import { ProviderError } from "@/lib/errors";
import type { GeocodingService, RoutingService } from "@/services/types";
import { GeoapifyRouting } from "@/services/routing/geoapify";
import { FallbackRouting } from "@/services/routing/fallback";

describe("GeoapifyPlacesService.searchHotels", () => {
  afterEach(() => vi.restoreAllMocks());

  it("searches a circle around the stop for hotels and drops listings without a name", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            { properties: { name: "Plains Inn", lat: 33.5, lon: -101.9, formatted: "1 Main St", place_id: "inn" } },
            { properties: { lat: 33.5, lon: -101.9, place_id: "unnamed" } },
          ],
        }),
      ),
    );

    const hotels = await new GeoapifyPlacesService("test-key").searchHotels([-101.9, 33.5], 16093.44);

    expect(hotels).toEqual([{ externalId: "inn", name: "Plains Inn", address: "1 Main St", latitude: 33.5, longitude: -101.9 }]);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.categories).toEqual(["accommodation.hotel"]);
    expect(body.filter).toEqual({ type: "circle", lon: -101.9, lat: 33.5, radius: 16093.44 });
  });
});

describe("OpenRouteServiceGeocoding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the search endpoint for both place searches and address lookups", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ features: [{ geometry: { coordinates: [-101.9, 35.1] }, properties: { label: "South Soncy Road, Amarillo, TX, USA", confidence: 0.8 } }] })),
    );

    const [match] = await new OpenRouteServiceGeocoding("test-key").resolve("2302 S Soncy Rd, Amarillo, TX 79124", 6);

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/geocode/search?");
    expect(match).toMatchObject({ latitude: 35.1, longitude: -101.9 });
    await new OpenRouteServiceGeocoding("test-key").search("Amarillo", 6);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/geocode/search?");
  });
});

describe("geocoder choice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("finds points of interest through Geoapify", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [{ geometry: { coordinates: [-106.79, 37.47] }, properties: { name: "Wolf Creek Ski Resort", formatted: "Wolf Creek Ski Resort, CO, USA", lon: -106.79, lat: 37.47 } }],
        }),
      ),
    );

    const [match] = await new GeoapifyGeocoding("test-key").search("Wolf Creek Ski Resort, CO", 6);

    expect(match).toMatchObject({ name: "Wolf Creek Ski Resort", label: "Wolf Creek Ski Resort, CO, USA", latitude: 37.47, longitude: -106.79 });
  });

  it("asks the backup geocoder when the primary provider refuses the request", async () => {
    const primary = { provider: "primary", mode: "live", search: vi.fn().mockRejectedValue(new ProviderError("primary", "unauthorized", "refused")), resolve: vi.fn() } as unknown as GeocodingService;
    const backup = {
      provider: "backup",
      mode: "live",
      search: vi.fn().mockResolvedValue([{ label: "Roswell, NM", name: "Roswell", latitude: 33.39, longitude: -104.52, confidence: null }]),
      resolve: vi.fn(),
    } as unknown as GeocodingService;

    const results = await new FallbackGeocoding(primary, backup).search("roswe", 6);

    expect(results).toHaveLength(1);
    expect(backup.search).toHaveBeenCalledWith("roswe", 6);
  });
});

describe("routing fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends latitude-first waypoints, the shortest route type and the toll rule, and reads a MultiLineString route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ features: [{ geometry: { type: "MultiLineString", coordinates: [[[-97.74, 30.27], [-97.5, 30.4]]] }, properties: { distance: 1000, time: 600 } }] }),
      ),
    );

    const leg = await new GeoapifyRouting("test-key").route([-97.74, 30.27], [-97.5, 30.4], { preference: "shortest", avoid: ["tollways"] });

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("waypoints")).toBe("30.27,-97.74|30.4,-97.5");
    expect(url.searchParams.get("type")).toBe("short");
    expect(url.searchParams.get("avoid")).toBe("tolls");
    expect(leg).toMatchObject({ distanceMeters: 1000, durationSeconds: 600, geometry: [[-97.74, 30.27], [-97.5, 30.4]] });
  });

  it("uses the backup router only when the primary provider fails", async () => {
    const backupLeg = { distanceMeters: 5, durationSeconds: 5, geometry: [[0, 0]], provider: "backup", mode: "live" } as const;
    const primary = { provider: "primary", mode: "live", route: vi.fn().mockRejectedValue(new ProviderError("primary", "rate_limited", "slow down")) } as unknown as RoutingService;
    const backup = { provider: "backup", mode: "live", route: vi.fn().mockResolvedValue(backupLeg) } as unknown as RoutingService;

    const leg = await new FallbackRouting(primary, backup).route([0, 0], [1, 1], { preference: "fastest", avoid: [] });

    expect(leg).toEqual(backupLeg);
    expect(backup.route).toHaveBeenCalledTimes(1);
  });
});

describe("filterHotels", () => {
  const hotels = [
    { externalId: "a", name: "Plains Inn", address: "1 Main St, Amarillo", latitude: 0, longitude: 0 },
    { externalId: "b", name: "Lone Star Motel", address: "9 Route 66", latitude: 0, longitude: 0 },
  ];

  it("keeps every hotel for an empty query", () => {
    expect(filterHotels(hotels, "  ")).toHaveLength(2);
  });

  it("matches name or address, ignoring case", () => {
    expect(filterHotels(hotels, "inn").map((hotel) => hotel.externalId)).toEqual(["a"]);
    expect(filterHotels(hotels, "ROUTE 66").map((hotel) => hotel.externalId)).toEqual(["b"]);
    expect(filterHotels(hotels, "hilton")).toEqual([]);
  });
});

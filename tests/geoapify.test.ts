import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequestBody, categorize, GeoapifyPlacesService, GEOAPIFY_CATEGORIES, interleave, mapFeatures, ORIGIN_EXCLUSION_METERS, segmentCount, splitRoute } from "@/services/places/geoapify";
import { haversineMeters } from "@/domain/geo";
import { ProviderError } from "@/lib/errors";

const route: [number, number][] = [
  [-97.7431, 30.2672],
  [-100.0, 33.0],
  [-105.9378, 35.687],
];
const options = { radiusMeters: 15000, maxResults: 25 };

describe("categorize", () => {
  it("maps Geoapify categories to app categories, preferring the more specific rule", () => {
    expect(categorize(["tourism.attraction.viewpoint"])?.category).toBe("Viewpoint");
    expect(categorize(["tourism.attraction.artwork.statue"])?.category).toBe("Attraction");
    expect(categorize(["entertainment.museum"])?.category).toBe("Museum & art");
    expect(categorize(["tourism.sights.castle"])?.category).toBe("Historic site");
    expect(categorize(["natural.mountain.peak"])?.category).toBe("Natural feature");
    expect(categorize(["catering.restaurant"])).toBeNull();
  });
});

describe("buildRequestBody", () => {
  it("sends the route as one polyline with the search radius as its buffer", () => {
    const body = buildRequestBody(route, options);
    expect(body.categories).toEqual(GEOAPIFY_CATEGORIES);
    expect(body.filter).toMatchObject({ type: "polyline", buffer: 15000, geometry: { type: "LineString" } });
    expect(body.filter.geometry.coordinates[0]).toEqual(route[0]);
    expect(body.limit).toBe(25);
  });
});

describe("mapFeatures", () => {
  it("keeps named, categorised places, ranks them by distance from the route, and drops the rest", () => {
    const places = mapFeatures(
      [
        { properties: { name: "Far Museum", lat: 40, lon: -90, categories: ["entertainment.museum"], place_id: "far" } },
        { properties: { name: "Near Park", lat: 33.01, lon: -100.01, categories: ["leisure.park"], formatted: "Near, TX", place_id: "near", website: "https://example.org/park" } },
        { properties: { lat: 33, lon: -100, categories: ["leisure.park"], place_id: "unnamed" } },
        { properties: { name: "Burger place", lat: 33, lon: -100, categories: ["catering.restaurant"], place_id: "food" } },
      ],
      route,
      { radiusMeters: 15000, maxResults: 10 },
    );
    expect(places.map((p) => p.name)).toEqual(["Near Park"]);
    expect(places[0]).toMatchObject({
      externalId: "near",
      category: "Park & nature",
      address: "Near, TX",
      sourceUrl: "https://example.org/park",
      image: null,
      description: "",
      visitMinutes: 120,
    });
    expect(places[0].detourDistanceMeters).toBeLessThan(2000);
  });

  it("uses coordinates from the geometry when the properties omit them", () => {
    const [place] = mapFeatures([{ geometry: { coordinates: [-100.01, 33.01] }, properties: { name: "Peak", categories: ["natural.mountain.peak"], place_id: "p" } }], route, options);
    expect(place).toMatchObject({ latitude: 33.01, longitude: -100.01, category: "Natural feature" });
  });

  it("leaves the source link empty rather than inventing one", () => {
    const [place] = mapFeatures([{ properties: { name: "Museum", lat: 33.01, lon: -100.01, categories: ["entertainment.museum"], place_id: "m" } }], route, options);
    expect(place.sourceUrl).toBeNull();
  });
});

describe("route segmentation and merging", () => {
  const long: [number, number][] = Array.from({ length: 200 }, (_, i) => [-100 + i * 0.05, 35 + i * 0.01]);

  it("splits a route into consecutive pieces that share their boundary points", () => {
    const segments = splitRoute(long, 4);
    expect(segments).toHaveLength(4);
    expect(segments[0][0]).toEqual(long[0]);
    expect(segments[3].at(-1)).toEqual(long.at(-1));
    for (let i = 1; i < segments.length; i++) expect(segments[i][0]).toEqual(segments[i - 1].at(-1));
  });

  it("uses one search per roughly 150 km, capped at six", () => {
    expect(segmentCount([[0, 0], [0.01, 0]])).toBe(1);
    expect(segmentCount(long)).toBeGreaterThanOrEqual(1);
    const farAway: [number, number][] = [[0, 0], [30, 0]];
    expect(segmentCount(farAway)).toBe(6);
  });

  it("takes results round-robin from each segment so one stretch cannot fill the list", () => {
    expect(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]], 5)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    expect(interleave([[1, 2], [3]], 10)).toEqual([1, 3, 2]);
  });

  it("excludes places near the starting point and spreads results across the route", async () => {
    const origin: [number, number] = [-97.7431, 30.2672];
    const far = (lng: number, lat: number, id: string) => ({ properties: { name: id, lat, lon: lng, categories: ["leisure.park"], place_id: id } });
    const nearOrigin = far(-97.74, 30.27, "near-origin");
    const midway = far(-101, 33, "midway");
    const end = far(-105.9, 35.6, "end");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const first = body.filter.geometry.coordinates[0];
      return new Response(JSON.stringify({ features: first[0] === origin[0] ? [nearOrigin, midway] : [end, midway] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const route = [origin, [-101, 33], [-105.9378, 35.687]] as [number, number][];
    const places = await new GeoapifyPlacesService("k").searchAlongRoute(route, { radiusMeters: 15000, maxResults: 4 });
    expect(places.map((p) => p.name)).not.toContain("near-origin");
    expect(places.map((p) => p.name).sort()).toEqual(["end", "midway"]);
    expect(haversineMeters(origin, [midway.properties.lon, midway.properties.lat])).toBeGreaterThan(ORIGIN_EXCLUSION_METERS);
    vi.unstubAllGlobals();
  });
});

describe("GeoapifyPlacesService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the key in a header, never in the URL, and maps the response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [{ properties: { name: "Park", lat: 33.01, lon: -100.01, categories: ["leisure.park"], place_id: "x" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const places = await new GeoapifyPlacesService("secret-key").searchAlongRoute(route, options);
    expect(places.map((p) => p.name)).toEqual(["Park"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.geoapify.com/v2/places");
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
  });

  it("reports rate limits and malformed responses as provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    const limited = await new GeoapifyPlacesService("k").searchAlongRoute(route, options).catch((e) => e);
    expect(limited).toBeInstanceOf(ProviderError);
    expect(limited.kind).toBe("rate_limited");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "oops" }), { status: 200 })));
    const malformed = await new GeoapifyPlacesService("k").searchAlongRoute(route, { ...options, maxResults: 3 }).catch((e) => e);
    expect(malformed.kind).toBe("invalid_response");
  });
});

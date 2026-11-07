import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOverpassQuery, categorize, OverpassPlacesService, parseWikipediaTag } from "@/services/places/overpass";
import { OpenRouteServiceRouting } from "@/services/routing/openrouteservice";
import { OpenRouteServiceGeocoding } from "@/services/geocoding/openrouteservice";
import { DemoRouting, DemoGeocoding } from "@/services/demo/demoServices";
import { ProviderError } from "@/lib/errors";
import type { ImageService } from "@/services/types";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("OpenRouteService routing adapter", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("maps provider summary and geometry to a route leg and sends the key in a header, not the URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        features: [{ geometry: { coordinates: [[-97.7, 30.2], [-104.9, 39.7]] }, properties: { summary: { distance: 1200000, duration: 46000 } } }],
      }),
    );
    const leg = await new OpenRouteServiceRouting("secret-key").route([-97.7, 30.2], [-104.9, 39.7], { preference: "fastest", avoid: ["tollways"] });
    expect(leg).toMatchObject({ distanceMeters: 1200000, durationSeconds: 46000, mode: "live", provider: "OpenRouteService" });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("secret-key");
    expect(JSON.parse(init.body as string).options.avoid_features).toEqual(["tollways"]);
  });

  it("reports rate limits as a ProviderError the UI can explain", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 429 }));
    const error = await new OpenRouteServiceRouting("k").route([0, 0], [1, 1], { preference: "fastest", avoid: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("rate_limited");
  });

  it("rejects incomplete provider responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ features: [] }));
    const error = await new OpenRouteServiceRouting("k").route([0, 0], [1, 1], { preference: "fastest", avoid: [] }).catch((e) => e);
    expect(error.kind).toBe("invalid_response");
  });

  it("retries once on a network failure", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ features: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { summary: { distance: 10, duration: 5 } } }] }));
    const leg = await new OpenRouteServiceRouting("k").route([0, 0], [1, 1], { preference: "fastest", avoid: [] });
    expect(leg.distanceMeters).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("OpenRouteService geocoding adapter", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns candidates with coordinates and skips features without them", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        features: [
          { geometry: { coordinates: [-105.9, 35.7] }, properties: { label: "Santa Fe, New Mexico, USA", name: "Santa Fe", confidence: 0.9 } },
          { geometry: {}, properties: { label: "broken" } },
        ],
      }),
    );
    const results = await new OpenRouteServiceGeocoding("k").search("Santa Fe", 5);
    expect(results).toEqual([{ label: "Santa Fe, New Mexico, USA", name: "Santa Fe", latitude: 35.7, longitude: -105.9, confidence: 0.9 }]);
  });
});

describe("demo providers", () => {
  it("label every result as demo data", async () => {
    const [candidate] = await new DemoGeocoding().search("denver", 3);
    expect(candidate.label).toMatch(/DEMO/);
    const leg = await new DemoRouting().route([-97.7, 30.2], [-104.9, 39.7]);
    expect(leg.mode).toBe("demo");
    expect(leg.distanceMeters).toBeGreaterThan(0);
  });
});

describe("Overpass places adapter", () => {
  it("categorises OSM tags and rejects unrelated tags", () => {
    expect(categorize({ tourism: "museum" })?.category).toBe("Museum & art");
    expect(categorize({ leisure: "park" })?.category).toBe("Park & nature");
    expect(categorize({ shop: "bakery" })).toBeNull();
  });

  it("builds a union query over every sampled point", () => {
    const query = buildOverpassQuery([[-97.7, 30.2], [-104.9, 39.7]], 15000);
    expect(query).toContain("nwr(around:15000,30.2,-97.7)");
    expect(query).toContain("nwr(around:15000,39.7,-104.9)");
    expect(query).toMatch(/out center tags/);
  });

  it("parses Wikipedia language:title tags", () => {
    expect(parseWikipediaTag("en:Carlsbad Caverns National Park")).toEqual({ language: "en", title: "Carlsbad Caverns National Park" });
    expect(parseWikipediaTag("no-colon")).toBeNull();
  });

  it("returns only named places near the route, ranked by detour, with source links and no invented images", async () => {
    const near = { type: "node", id: 1, lat: 35.0, lon: -106.0, tags: { name: "Near Museum", tourism: "museum", "addr:city": "Albuquerque" } };
    const far = { type: "node", id: 2, lat: 40.0, lon: -90.0, tags: { name: "Far Park", leisure: "park" } };
    const unnamed = { type: "node", id: 3, lat: 35.0, lon: -106.0, tags: { tourism: "museum" } };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("overpass")) return jsonResponse({ elements: [near, far, unnamed] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const images: ImageService = { mode: "live", findImageForUpload: vi.fn(async () => null) };
    const service = new OverpassPlacesService("https://overpass.example/api", images, "test-agent");
    const route: [number, number][] = [[-106.0, 35.0], [-105.0, 36.0]];
    const places = await service.searchAlongRoute(route, { radiusMeters: 15000, maxResults: 10 });
    expect(places.map((p) => p.name)).toEqual(["Near Museum"]);
    expect(places[0].sourceUrl).toBe("https://www.openstreetmap.org/node/1");
    expect(places[0].image).toBeNull();
    expect(places[0].visitMinutes).toBe(90);
    vi.unstubAllGlobals();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeoapifyRouting } from "@/services/routing/geoapify";
import { OpenRouteServiceRouting } from "@/services/routing/openrouteservice";
import { OpenRouteServiceGeocoding } from "@/services/geocoding/openrouteservice";
import { DemoRouting, DemoGeocoding } from "@/services/demo/demoServices";
import { ProviderError } from "@/lib/errors";

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

  it("asks the router to snap each stop to a road within 5 km", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ features: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { summary: { distance: 1, duration: 1 } } }] }),
    );
    await new OpenRouteServiceRouting("k").route([0, 0], [1, 1], { preference: "fastest", avoid: [] });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).radiuses).toEqual([5000, 5000]);
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

describe("Geoapify routing adapter", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("reports a waypoint with no road nearby as not_found, so the user is asked to move the stop", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "No suitable edges near location." }), { status: 400 }));
    const error = await new GeoapifyRouting("k").route([-104.6, 32.12], [-97.7, 30.27], { preference: "fastest", avoid: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("not_found");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps other bad requests as invalid_response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "Invalid waypoints." }), { status: 400 }));
    const error = await new GeoapifyRouting("k").route([0, 0], [1, 1], { preference: "fastest", avoid: [] }).catch((e) => e);
    expect(error.kind).toBe("invalid_response");
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


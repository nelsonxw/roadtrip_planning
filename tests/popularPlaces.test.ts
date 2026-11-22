import { afterEach, describe, expect, it, vi } from "vitest";
import { briefExtract, buildPrompt, clearPopularPlacesCache, excludeNearEndpoints, MAX_DISTANCE_METERS, parseSuggestions, routeContext, verifySuggestion } from "@/server/popularPlaces";
import type { Services } from "@/services/providers";
import type { TripView } from "@/server/tripService";
import type { Stop } from "@/domain/trip";

const route: [number, number][] = [
  [-101.83, 35.22],
  [-101.7, 34.9],
];

const view = {
  id: "t",
  name: "Test trip",
  stops: [
    { id: "a", name: "Amarillo", stopType: "origin", latitude: 35.22, longitude: -101.83 },
    { id: "b", name: "Pagosa Springs", stopType: "destination", latitude: 37.26, longitude: -107.01 },
  ],
  routeGeometry: route,
} as unknown as TripView;

/** Wikidata answers for the two lookups the code makes: name search, then entity details. */
function mockWikidata(entity: { label: string; latitude: number; longitude: number }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("action") === "wbsearchentities") {
      return new Response(JSON.stringify({ search: [{ id: "Q1" }] }));
    }
    return new Response(
      JSON.stringify({
        entities: {
          Q1: {
            labels: { en: { value: entity.label } },
            claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: entity.latitude, longitude: entity.longitude } } } }] },
          },
        },
      }),
    );
  });
}

describe("buildPrompt", () => {
  it("states the 50-mile rule and lists the stops", () => {
    const prompt = buildPrompt(view);
    expect(prompt).toMatch(/within 50 miles of this route or these stops/);
    expect(prompt).toContain("Amarillo (origin)");
    expect(prompt).toContain("Pagosa Springs (destination)");
  });

  it("includes the towns the route passes through and the route path", () => {
    const prompt = buildPrompt(view, { towns: ["Carlsbad, New Mexico", "Roswell, New Mexico"], path: route });
    expect(prompt).toContain("Towns near the route:\n- Carlsbad, New Mexico");
    expect(prompt).toContain("Route path (lat, lon), in order:");
    expect(prompt).toContain("- 35.220, -101.830");
  });

  it("asks the model to skip the origin and return area when the user declines them", () => {
    expect(buildPrompt(view, { towns: [], path: [] }, false)).toMatch(/Do not suggest places within 50 miles of the origin or the return point/);
    expect(buildPrompt(view, { towns: [], path: [] }, true)).not.toMatch(/Do not suggest places within 50 miles/);
  });
});

describe("routeContext", () => {
  it("lists cities before towns, nearer places first, and stops at the limit", async () => {
    const village = (i: number) => ({ externalId: `v${i}`, name: `Village ${i}`, kind: "village" as const, region: "Texas", latitude: 35.0, longitude: -101.74 + i * 0.001 });
    const city = { externalId: "c", name: "Far City", kind: "city" as const, region: "New Mexico", latitude: 35.0, longitude: -102.5 };
    const towns = [...Array.from({ length: 45 }, (_, i) => village(i)), city];
    const services = { places: { searchSettlements: async () => towns } } as unknown as Services;
    // Distances are measured to route vertices, so the test route needs enough points to sit on the line.
    const denseRoute: [number, number][] = Array.from({ length: 101 }, (_, i) => [-101.83 + i * 0.0013, 35.22 - i * 0.0032]);
    const context = await routeContext({ ...view, routeGeometry: denseRoute } as TripView, services);
    expect(context.towns).toHaveLength(40);
    expect(context.towns[0]).toBe("Far City, New Mexico");
    expect(context.towns[1]).toBe("Village 0, Texas");
  });
});

describe("excludeNearEndpoints", () => {
  const stop = (stopType: string, latitude: number, longitude: number) => ({ stopType, latitude, longitude }) as unknown as Stop;
  const stops = [stop("origin", 35.22, -101.83), stop("destination", 37.26, -107.01), stop("return", 35.22, -101.83), stop("required", 32.1753, -104.4431)];

  it("drops places within 50 miles of the origin or return, and keeps the destination area and the rest", () => {
    const nearOrigin = { name: "Near origin", latitude: 35.3, longitude: -101.9 };
    const nearDestination = { name: "Near destination", latitude: 37.3, longitude: -107.0 };
    const midRoute = { name: "Mid route", latitude: 34.9, longitude: -103.0 };
    expect(excludeNearEndpoints([nearOrigin, nearDestination, midRoute], stops).map((p) => p.name)).toEqual(["Near destination", "Mid route"]);
  });

  it("ignores optional and required stops when deciding what is near an end", () => {
    const atRequiredStop = { name: "At required stop", latitude: 32.1753, longitude: -104.4431 };
    expect(excludeNearEndpoints([atRequiredStop], stops)).toHaveLength(1);
  });
});

describe("briefExtract", () => {
  it("keeps a short summary whole", () => {
    expect(briefExtract("A canyon in Texas.")).toBe("A canyon in Texas.");
  });

  it("cuts a long summary at a sentence end, so the popup ends cleanly", () => {
    const text = "First sentence about the park. Second sentence with more detail. " + "x".repeat(400);
    expect(briefExtract(text, 120)).toBe("First sentence about the park. Second sentence with more detail.");
  });
});

describe("parseSuggestions", () => {
  it("reads a well-formed answer", () => {
    const places = parseSuggestions(JSON.stringify({ places: [{ name: "Palo Duro Canyon State Park", type: "state park", reason: "Second-largest canyon in the US." }] }));
    expect(places).toEqual([{ name: "Palo Duro Canyon State Park", type: "state park", reason: "Second-largest canyon in the US." }]);
  });

  it("rejects text that is not JSON, and JSON in the wrong shape", () => {
    expect(() => parseSuggestions("Here are some places")).toThrow(/could not be read/);
    expect(() => parseSuggestions(JSON.stringify({ places: "none" }))).toThrow(/expected form/);
  });
});

describe("verifySuggestion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPopularPlacesCache();
  });

  it("confirms a place whose Wikidata coordinates are close to the route", async () => {
    mockWikidata({ label: "Palo Duro Canyon State Park", latitude: 34.93, longitude: -101.66 });
    const match = await verifySuggestion("Palo Duro Canyon State Park", route, "test-agent");
    expect(match).toMatchObject({ id: "Q1", latitude: 34.93, longitude: -101.66 });
    expect(match!.distanceMeters).toBeLessThanOrEqual(MAX_DISTANCE_METERS);
  });

  it("drops a place more than 50 miles from the route", async () => {
    mockWikidata({ label: "Palo Duro Canyon State Park", latitude: 40.0, longitude: -105.0 });
    expect(await verifySuggestion("Palo Duro Canyon State Park", route, "test-agent")).toBeNull();
  });

  it("drops a match whose Wikidata label is a different place", async () => {
    mockWikidata({ label: "Lake Tahoe", latitude: 34.93, longitude: -101.66 });
    expect(await verifySuggestion("Palo Duro Canyon State Park", route, "test-agent")).toBeNull();
  });
});

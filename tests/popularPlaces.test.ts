import { afterEach, describe, expect, it, vi } from "vitest";
import { briefExtract, buildPrompt, MAX_DISTANCE_METERS, parseSuggestions, verifySuggestion } from "@/server/popularPlaces";
import type { TripView } from "@/server/tripService";

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
  afterEach(() => vi.restoreAllMocks());

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

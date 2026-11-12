import { describe, expect, it } from "vitest";
import { applyOperations, DEFAULT_PREFERENCES, makeReturnStop, type Stop, type TripOperation } from "@/domain/trip";
import { buildItinerary } from "@/domain/itinerary";

const stop = (id: string, stopType: Stop["stopType"], latitude: number, longitude: number, sequence: number): Stop => ({
  id, name: id, address: "", latitude, longitude, sequence, stopType, source: "user", notes: "", visitMinutes: null, overnight: false,
});

const oneWay = (): Stop[] => [stop("origin", "origin", 30.27, -97.74, 0), stop("destination", "destination", 39.74, -104.99, 1)];

const add = (name: string, leg: "outbound" | "return" = "outbound", index?: number): TripOperation => ({
  type: "add_stop", name, address: "", latitude: 35, longitude: -105, stopType: "optional", leg, source: "user", notes: "", visitMinutes: null, index,
});

const ids = (stops: Stop[]) => stops.map((s) => s.id);

describe("round trip", () => {
  it("turning round trip on appends a return stop at the origin's location", () => {
    const result = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: true }]);
    const last = result.stops.at(-1)!;
    expect(last.stopType).toBe("return");
    expect([last.latitude, last.longitude]).toEqual([30.27, -97.74]);
    expect(result.stops.map((s) => s.sequence)).toEqual([0, 1, 2]);
  });

  it("turning round trip off removes the return stop", () => {
    const withReturn = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: true }]).stops;
    const result = applyOperations({ stops: withReturn, preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: false }]);
    expect(result.stops.some((s) => s.stopType === "return")).toBe(false);
  });

  it("keeps the return last when stops are added, moved and optimised", () => {
    let stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: true }]).stops;
    stops = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [add("museum"), add("park")]).stops;
    expect(stops.at(-1)!.stopType).toBe("return");
    expect(stops.at(-2)!.stopType).toBe("destination");

    const moved = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "move_stop", stopId: ids(stops)[1], toIndex: 1 }]).stops;
    expect(moved.at(-1)!.stopType).toBe("return");

    const optimised = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "optimize_order" }]).stops;
    expect(optimised.at(-1)!.stopType).toBe("return");
    expect(optimised.at(-2)!.stopType).toBe("destination");
  });

  it("refuses to remove or move the return stop directly", () => {
    const stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: true }]).stops;
    const returnId = stops.at(-1)!.id;
    expect(() => applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "remove_stop", stopId: returnId, confirmRequired: true }])).toThrow(/cannot be removed/);
    expect(() => applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "move_stop", stopId: returnId, toIndex: 0 }])).toThrow(/cannot be reordered/);
  });

  it("adds the return leg to the itinerary, with no visit time at the return", () => {
    const stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_round_trip", enabled: true }]).stops;
    const legs = [
      { distanceMeters: 1000, durationSeconds: 3600, provider: "t", status: "ok" as const },
      { distanceMeters: 1000, durationSeconds: 3600, provider: "t", status: "ok" as const },
    ];
    const itinerary = buildItinerary({ stops, legs, preferences: DEFAULT_PREFERENCES, durationDays: null, startDate: null });
    const lastItem = itinerary.days.at(-1)!.items.at(-1)!;
    expect(lastItem.stopType).toBe("return");
    expect(lastItem.visitMinutes).toBe(0);
    expect(itinerary.totals.driveDurationSeconds).toBe(7200);
  });

  it("places a return-leg stop after the destination and before the return to origin", () => {
    let stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [add("lunch")]).stops;
    stops = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [add("Amarillo", "return"), add("Abilene", "return")]).stops;
    expect(stops.map((s) => s.name)).toEqual(["origin", "lunch", "destination", "Amarillo", "Abilene", "origin"]);
    expect(stops.at(-1)!.stopType).toBe("return");
  });

  it("keeps outbound stops before the destination when adding after a return-leg stop exists", () => {
    let stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [add("Amarillo", "return")]).stops;
    stops = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [add("Lubbock")]).stops;
    expect(stops.map((s) => s.name)).toEqual(["origin", "Lubbock", "destination", "Amarillo", "origin"]);
  });

  it("moves an existing outbound stop onto the return trip when asked", () => {
    let stops = applyOperations({ stops: oneWay(), preferences: DEFAULT_PREFERENCES }, [add("Amarillo"), add("Abilene")]).stops;
    const amarillo = stops.find((s) => s.name === "Amarillo")!;
    stops = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "move_stop", stopId: amarillo.id, toIndex: 0, leg: "return" }]).stops;
    expect(stops.map((s) => s.name)).toEqual(["origin", "Abilene", "destination", "Amarillo", "origin"]);
  });

  it("ends the day at a stop marked overnight, even when the daily limit is not reached", () => {
    const stops = [
      stop("origin", "origin", 30.27, -97.74, 0),
      { ...stop("lubbock", "optional", 33.5, -101.9, 1), overnight: true },
      stop("amarillo", "optional", 35.2, -101.8, 2),
      stop("destination", "destination", 39.74, -104.99, 3),
    ];
    const legs = [
      { distanceMeters: 1000, durationSeconds: 3600, provider: "t", status: "ok" as const },
      { distanceMeters: 1000, durationSeconds: 3600, provider: "t", status: "ok" as const },
      { distanceMeters: 1000, durationSeconds: 3600, provider: "t", status: "ok" as const },
    ];
    const itinerary = buildItinerary({ stops, legs, preferences: DEFAULT_PREFERENCES, durationDays: null, startDate: null });
    expect(itinerary.days).toHaveLength(2);
    expect(itinerary.days[0].overnightStopId).toBe("lubbock");
    expect(itinerary.days[1].startStopId).toBe("lubbock");
  });

  it("makeReturnStop copies the origin's name, address and coordinates", () => {
    const origin = { ...stop("o", "origin", 30.27, -97.74, 0), name: "Austin", address: "Austin, TX" };
    const ret = makeReturnStop(origin);
    expect(ret).toMatchObject({ stopType: "return", name: "Austin", address: "Austin, TX", latitude: 30.27, longitude: -97.74 });
    expect(ret.id).not.toBe(origin.id);
  });
});

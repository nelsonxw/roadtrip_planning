import { describe, expect, it } from "vitest";
import { applyOperations, DEFAULT_PREFERENCES, makeReturnStop, renumber, startOverOperations, type Stop } from "@/domain/trip";

const stop = (id: string, stopType: Stop["stopType"], sequence: number, latitude = 30 + sequence, longitude = -100): Stop => ({
  id,
  name: id,
  address: "",
  latitude,
  longitude,
  sequence,
  stopType,
  source: "user",
  notes: "",
  visitMinutes: null,
  overnight: false,
  hotels: [],
  dayTrips: [],
});

describe("start over", () => {
  it("keeps only the origin and destination of a one-way trip", () => {
    const before = { stops: [stop("o", "origin", 0), stop("a", "required", 1), stop("b", "optional", 2), stop("d", "destination", 3)], preferences: DEFAULT_PREFERENCES };
    const result = applyOperations(before, startOverOperations(before.stops, false));
    expect(result.stops.map((item) => item.stopType)).toEqual(["origin", "destination"]);
  });

  it("removes the middle stops and the return of a round trip", () => {
    const origin = stop("o", "origin", 0);
    const destination = stop("d", "destination", 1, 35);
    const middle = stop("a", "required", 2, 33);
    const before = { stops: renumber([origin, middle, destination, makeReturnStop(origin)]), preferences: DEFAULT_PREFERENCES };
    const result = applyOperations(before, startOverOperations(before.stops, true));
    expect(result.stops.map((item) => item.stopType)).toEqual(["origin", "destination"]);
  });

  it("returns no operations when there is nothing to remove", () => {
    expect(startOverOperations([stop("o", "origin", 0), stop("d", "destination", 1)], false)).toEqual([]);
  });
});

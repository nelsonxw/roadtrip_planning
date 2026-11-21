import { describe, expect, it } from "vitest";
import { applyOperations, DEFAULT_PREFERENCES, makeReturnStop, renumber, type Stop, type TripOperation } from "@/domain/trip";

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

/** The operations the "Start over" button sends for a trip with the given stops. */
function startOverOperations(stops: Stop[], roundTrip: boolean): TripOperation[] {
  const middle = stops.filter((item) => item.stopType === "required" || item.stopType === "optional");
  const removals: TripOperation[] = middle.map((item) => ({ type: "remove_stop", stopId: item.id, confirmRequired: true }));
  return roundTrip ? [...removals, { type: "set_round_trip", enabled: false }] : removals;
}

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
});

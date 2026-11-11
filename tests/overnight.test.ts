import { describe, expect, it } from "vitest";
import { chooseOvernightStops, drivingDaysNeeded, projectFraction, cumulativeMeters, type Settlement } from "@/domain/overnight";

const HOUR = 3600;
const settlement = (id: string, fraction: number, kind: Settlement["kind"], detourMeters = 2000): Settlement => ({
  id, name: id, kind, latitude: 0, longitude: 0, fraction, detourMeters,
});

describe("drivingDaysNeeded", () => {
  it("needs one day when the trip fits the daily limit", () => {
    expect(drivingDaysNeeded(5 * HOUR, 6 * HOUR)).toBe(1);
  });

  it("rounds up to whole driving days and caps the count", () => {
    expect(drivingDaysNeeded(13 * HOUR, 6 * HOUR)).toBe(3);
    expect(drivingDaysNeeded(1000 * HOUR, 6 * HOUR)).toBe(10);
  });
});

describe("chooseOvernightStops", () => {
  it("suggests nothing for a trip that fits in one day", () => {
    expect(chooseOvernightStops(4 * HOUR, 6 * HOUR, [settlement("a", 0.5, "town")])).toEqual([]);
  });

  it("splits a long trip into evenly spaced nights, one per split point", () => {
    const towns = [settlement("early", 0.33, "town"), settlement("late", 0.66, "town")];
    const suggestions = chooseOvernightStops(18 * HOUR, 6 * HOUR, towns);
    expect(suggestions.map((s) => [s.afterDay, s.settlement.id])).toEqual([
      [1, "early"],
      [2, "late"],
    ]);
  });

  it("prefers a larger place when two are similarly close to the split point", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [settlement("village", 0.5, "village"), settlement("city", 0.52, "city")]);
    expect(suggestions[0].settlement.id).toBe("city");
  });

  it("skips a split point when no settlement is close enough, rather than forcing a poor match", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [settlement("far", 0.95, "city")]);
    expect(suggestions).toEqual([]);
  });

  it("ignores settlements that are too far off the route", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [settlement("remote", 0.5, "city", 80000)]);
    expect(suggestions).toEqual([]);
  });

  it("never uses the same town for two nights", () => {
    const suggestions = chooseOvernightStops(18 * HOUR, 6 * HOUR, [settlement("only", 0.5, "town")]);
    expect(new Set(suggestions.map((s) => s.settlement.id)).size).toBe(suggestions.length);
  });
});

describe("route projection", () => {
  it("places a point along the route as a fraction of its total length", () => {
    const route: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    const cumulative = cumulativeMeters(route);
    expect(projectFraction([0, 0], route, cumulative)).toBe(0);
    expect(projectFraction([2, 0], route, cumulative)).toBe(1);
    expect(projectFraction([1, 0.001], route, cumulative)).toBeCloseTo(0.5, 2);
  });
});

import { describe, expect, it } from "vitest";
import { pickCurrentPopulation } from "@/services/population/wikidata";
import { chooseOvernightStops, cumulativeMeters, drivingDaysNeeded, isEligible, projectFraction, type Settlement } from "@/domain/overnight";

const HOUR = 3600;
const town = (id: string, fraction: number, population: number | null, detourMeters = 2000): Settlement => ({
  id, name: id, latitude: 0, longitude: 0, fraction, detourMeters, population,
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

describe("population eligibility", () => {
  it("accepts only places with a known population at or above the minimum", () => {
    expect(isEligible(town("big", 0.5, 25000), 10000)).toBe(true);
    expect(isEligible(town("small", 0.5, 3000), 10000)).toBe(false);
    expect(isEligible(town("unknown", 0.5, null), 10000)).toBe(false);
  });
});

describe("chooseOvernightStops", () => {
  it("suggests nothing for a trip that fits in one day", () => {
    expect(chooseOvernightStops(4 * HOUR, 6 * HOUR, [town("a", 0.5, 50000)])).toEqual([]);
  });

  it("splits a long trip into evenly spaced nights, one per split point", () => {
    const towns = [town("early", 0.33, 40000), town("late", 0.66, 40000)];
    const suggestions = chooseOvernightStops(18 * HOUR, 6 * HOUR, towns);
    expect(suggestions.map((s) => [s.afterDay, s.settlement.id])).toEqual([
      [1, "early"],
      [2, "late"],
    ]);
  });

  it("never suggests a place below the minimum population, even when it is the closest", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [town("hamlet", 0.5, 800), town("city", 0.55, 90000)], 10000);
    expect(suggestions.map((s) => s.settlement.id)).toEqual(["city"]);
  });

  it("never suggests a place with an unknown population", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [town("unknown", 0.5, null)], 10000);
    expect(suggestions).toEqual([]);
  });

  it("prefers the larger of two similarly placed towns", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [town("small", 0.5, 12000), town("large", 0.51, 300000)], 10000);
    expect(suggestions[0].settlement.id).toBe("large");
  });

  it("skips a split point when no eligible place is close enough, rather than forcing a poor match", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [town("far", 0.95, 90000)], 10000);
    expect(suggestions).toEqual([]);
  });

  it("ignores settlements that are too far off the route", () => {
    const suggestions = chooseOvernightStops(12 * HOUR, 6 * HOUR, [town("remote", 0.5, 90000, 80000)], 10000);
    expect(suggestions).toEqual([]);
  });

  it("leaves a night free when the user has already chosen an overnight stop for it", () => {
    const towns = [town("sweetwater", 0.14, 10622), town("farmington", 0.6, 46624)];
    const suggestions = chooseOvernightStops(18 * HOUR, 6 * HOUR, towns, 10000, [0.3]);
    expect(suggestions.map((s) => s.afterDay)).toEqual([2]);
    expect(suggestions.map((s) => s.settlement.id)).toEqual(["farmington"]);
  });

  it("never uses the same town for two nights", () => {
    const suggestions = chooseOvernightStops(18 * HOUR, 6 * HOUR, [town("only", 0.5, 90000)], 10000);
    expect(new Set(suggestions.map((s) => s.settlement.id)).size).toBe(suggestions.length);
  });
});

describe("Wikidata population choice", () => {
  const claim = (amount: string, time: string, rank = "normal") => ({
    mainsnak: { datavalue: { value: { amount } } },
    rank,
    qualifiers: { P585: [{ datavalue: { value: { time } } }] },
  });

  it("uses the most recent dated figure rather than an old census", () => {
    const claims = [claim("+482", "+1850-01-01T00:00:00Z"), claim("+200000", "+2020-01-01T00:00:00Z"), claim("+150000", "+2010-01-01T00:00:00Z")];
    expect(pickCurrentPopulation(claims)).toBe(200000);
  });

  it("prefers a preferred-rank figure over a newer normal-rank one", () => {
    const claims = [claim("+90000", "+2022-01-01T00:00:00Z"), claim("+120000", "+2019-01-01T00:00:00Z", "preferred")];
    expect(pickCurrentPopulation(claims)).toBe(120000);
  });

  it("ignores deprecated figures and returns null when nothing usable remains", () => {
    expect(pickCurrentPopulation([claim("+5000", "+2020-01-01T00:00:00Z", "deprecated")])).toBeNull();
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

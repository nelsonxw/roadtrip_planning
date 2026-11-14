import { describe, expect, it } from "vitest";
import { buildItinerary, DEFAULT_VISIT_MINUTES, type LegMetrics } from "@/domain/itinerary";
import { haversineMeters, sampleLine } from "@/domain/geo";
import { applyOperations, DEFAULT_PREFERENCES, nearestNeighborOrder, type Stop, type TripOperation } from "@/domain/trip";

const stop = (id: string, stopType: Stop["stopType"], latitude: number, longitude: number, sequence: number, extra: Partial<Stop> = {}): Stop => ({
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
  ...extra,
});

const baseStops = () => [
  stop("origin", "origin", 30.27, -97.74, 0),
  stop("lunch", "required", 30.5, -98.0, 1),
  stop("destination", "destination", 39.74, -104.99, 2),
];

const add = (name: string, extra: Partial<Extract<TripOperation, { type: "add_stop" }>> = {}): TripOperation => ({
  type: "add_stop",
  name,
  address: "",
  latitude: 35,
  longitude: -105,
  stopType: "optional",
  source: "user",
  notes: "",
  visitMinutes: null,
  ...extra,
});

describe("applyOperations", () => {
  it("adds stops in the requested position and keeps origin and destination at the ends", () => {
    const result = applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [add("museum", { index: 0 }), add("park")]);
    expect(result.stops.map((s) => s.name)).toEqual(["origin", "museum", "lunch", "park", "destination"]);
    expect(result.stops.map((s) => s.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses to remove a required stop without explicit confirmation", () => {
    expect(() => applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "remove_stop", stopId: "lunch", confirmRequired: false }])).toThrow(
      /confirm/i,
    );
    const confirmed = applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "remove_stop", stopId: "lunch", confirmRequired: true }]);
    expect(confirmed.stops.map((s) => s.id)).toEqual(["origin", "destination"]);
  });

  it("removes optional stops without confirmation and never removes endpoints", () => {
    const stops = [stop("origin", "origin", 30.27, -97.74, 0), stop("lunch", "required", 30.5, -98.0, 1), stop("gallery", "optional", 31, -100, 2), stop("destination", "destination", 39.74, -104.99, 3)];
    const result = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "remove_stop", stopId: "gallery", confirmRequired: false }]);
    expect(result.stops.map((s) => s.id)).not.toContain("gallery");
    expect(() => applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "remove_stop", stopId: "origin", confirmRequired: true }])).toThrow(/cannot be removed/);
  });

  it("moves stops by index among intermediate stops", () => {
    const stops = [stop("origin", "origin", 30.27, -97.74, 0), stop("lunch", "required", 30.5, -98.0, 1), stop("a", "optional", 31, -100, 2), stop("b", "optional", 32, -101, 3), stop("destination", "destination", 39.74, -104.99, 4)];
    const result = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "move_stop", stopId: "b", toIndex: 0 }]);
    expect(result.stops.map((s) => s.id)).toEqual(["origin", "b", "lunch", "a", "destination"]);
  });

  it("does not reorder stops unless optimisation is requested", () => {
    const stops = [stop("origin", "origin", 30.27, -97.74, 0), stop("lunch", "required", 30.5, -98.0, 1), stop("far", "optional", 45, -120, 2), stop("near", "optional", 30.6, -98.1, 3), stop("destination", "destination", 39.74, -104.99, 4)];
    const untouched = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "update_stop", stopId: "far", notes: "keep" }]);
    expect(untouched.stops.map((s) => s.id)).toEqual(["origin", "lunch", "far", "near", "destination"]);
    const optimised = applyOperations({ stops, preferences: DEFAULT_PREFERENCES }, [{ type: "optimize_order" }]);
    expect(optimised.stops.map((s) => s.id)).toEqual(["origin", "lunch", "near", "far", "destination"]);
  });

  it("validates coordinates and rejects missing endpoints", () => {
    const withoutDestination = baseStops().filter((s) => s.stopType !== "destination");
    expect(() => applyOperations({ stops: withoutDestination, preferences: DEFAULT_PREFERENCES }, [add("x")])).toThrow(/destination/);
  });

  it("updates preferences", () => {
    const result = applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "set_preferences", maxDailyDriveMinutes: 240 }]);
    expect(result.preferences.maxDailyDriveMinutes).toBe(240);
  });
});

describe("nearestNeighborOrder", () => {
  it("keeps endpoints fixed", () => {
    const ordered = nearestNeighborOrder([stop("origin", "origin", 30.27, -97.74, 0), stop("x", "optional", 31, -100, 1), stop("destination", "destination", 39.74, -104.99, 2)]);
    expect(ordered[0].stopType).toBe("origin");
    expect(ordered[ordered.length - 1].stopType).toBe("destination");
  });
});

describe("buildItinerary", () => {
  const legs = (...durations: number[]): LegMetrics[] =>
    durations.map((seconds) => ({ distanceMeters: seconds * 20, durationSeconds: seconds, provider: "test", status: "ok" }));

  it("splits days at the daily driving limit and sets overnight stops", () => {
    const stops = [stop("o", "origin", 0, 0, 0), stop("a", "optional", 0, 1, 1), stop("b", "optional", 0, 2, 2), stop("d", "destination", 0, 3, 3)];
    const result = buildItinerary({
      stops,
      legs: legs(3 * 3600, 3 * 3600, 2 * 3600),
      preferences: { maxDailyDriveMinutes: 360 },
      durationDays: null,
      startDate: "2026-07-01",
    });
    // 3h + 3h fits the 6h limit; the next 2h leg would exceed it, so day 1 ends at "b".
    expect(result.days).toHaveLength(2);
    expect(result.days[0].overnightStopId).toBe("b");
    expect(result.days[1].startStopId).toBe("b");
    expect(result.days[1].date).toBe("2026-07-02");
    expect(result.days[1].overnightStopId).toBeNull();
    expect(result.totals.driveDurationSeconds).toBe(8 * 3600);
  });

  it("reports when the route needs more driving days than the trip allows", () => {
    const stops = [stop("o", "origin", 0, 0, 0), stop("a", "optional", 0, 1, 1), stop("b", "optional", 0, 2, 2), stop("d", "destination", 0, 3, 3)];
    const result = buildItinerary({ stops, legs: legs(3 * 3600, 3 * 3600, 3 * 3600), preferences: { maxDailyDriveMinutes: 360 }, durationDays: 1, startDate: null });
    expect(result.days.length).toBeGreaterThan(1);
    expect(result.warnings.join(" ")).toMatch(/driving days, but the trip is 1 day/);
  });

  it("adds rest days when the trip is longer than the driving need and labels estimated visit times", () => {
    const stops = [stop("o", "origin", 0, 0, 0), stop("d", "destination", 0, 3, 1)];
    const result = buildItinerary({ stops, legs: legs(3600), preferences: { maxDailyDriveMinutes: 360 }, durationDays: 3, startDate: null });
    expect(result.days.map((d) => d.kind)).toEqual(["driving", "rest", "rest"]);
    expect(result.days[0].items[1].visitMinutes).toBe(DEFAULT_VISIT_MINUTES);
    expect(result.days[0].items[1].visitMinutesIsEstimate).toBe(true);
  });

  it("marks legs that failed to calculate instead of counting them as zero", () => {
    const stops = [stop("o", "origin", 0, 0, 0), stop("d", "destination", 0, 3, 1)];
    const result = buildItinerary({ stops, legs: [{ distanceMeters: 0, durationSeconds: 0, provider: "none", status: "missing" }], preferences: { maxDailyDriveMinutes: 360 }, durationDays: null, startDate: null });
    expect(result.days[0].warnings[0]).toMatch(/not calculated yet/);
  });
});

describe("hotels at overnight stops", () => {
  const legs = (...durations: number[]): LegMetrics[] =>
    durations.map((seconds) => ({ distanceMeters: seconds * 20, durationSeconds: seconds, provider: "test", status: "ok" }));
  const overnightStops = (hotels: Stop["hotels"] = []) => [
    stop("o", "origin", 0, 0, 0),
    stop("a", "optional", 0, 1, 1, { overnight: true, hotels }),
    stop("d", "destination", 0, 3, 2),
  ];
  const itinerary = (stops: Stop[]) =>
    buildItinerary({ stops, legs: legs(3600, 3600), preferences: { maxDailyDriveMinutes: 360 }, durationDays: null, startDate: null });
  const hotel = (id: string, nights: number): Stop["hotels"][number] => ({ id, name: `Hotel ${id}`, address: "", nights });
  const stopNamed = (stops: Stop[], id: string) => stops.find((item) => item.id === id)!;

  it("plans one night at an overnight stop with no hotel listed", () => {
    expect(itinerary(overnightStops()).days.map((d) => d.kind)).toEqual(["driving", "driving"]);
  });

  it("adds a no-driving day at the same stop for each extra night", () => {
    const result = itinerary(overnightStops([hotel("h1", 3)]));
    expect(result.days.map((d) => d.kind)).toEqual(["driving", "rest", "rest", "driving"]);
    expect(result.days[1]).toMatchObject({ startStopId: "a", overnightStopId: "a", driveDurationSeconds: 0 });
    expect(result.days[3].startStopId).toBe("a");
    expect(result.totals.drivingDays).toBe(2);
  });

  it("adds up the nights of several hotels at one stop", () => {
    const result = itinerary(overnightStops([hotel("h1", 2), hotel("h2", 1)]));
    expect(result.days.filter((d) => d.kind === "rest")).toHaveLength(2);
  });

  it("adds, updates and removes hotels on an overnight stop", () => {
    const added = applyOperations({ stops: overnightStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "add_hotel", stopId: "a", name: "Inn", nights: 2 }]);
    const hotelId = stopNamed(added.stops, "a").hotels[0].id;
    expect(stopNamed(added.stops, "a").hotels).toEqual([{ id: hotelId, name: "Inn", address: "", nights: 2, latitude: null, longitude: null }]);

    const updated = applyOperations({ stops: added.stops, preferences: DEFAULT_PREFERENCES }, [{ type: "update_hotel", stopId: "a", hotelId, nights: 4 }]);
    expect(stopNamed(updated.stops, "a").hotels[0].nights).toBe(4);

    const removed = applyOperations({ stops: updated.stops, preferences: DEFAULT_PREFERENCES }, [{ type: "remove_hotel", stopId: "a", hotelId }]);
    expect(stopNamed(removed.stops, "a").hotels).toEqual([]);
  });

  it("stores a hotel's located coordinates and clears them when the hotel is updated without them", () => {
    const added = applyOperations(
      { stops: overnightStops(), preferences: DEFAULT_PREFERENCES },
      [{ type: "add_hotel", stopId: "a", name: "Inn", address: "1 Main St", nights: 1, latitude: 35.2, longitude: -101.8 }],
    );
    const hotelId = stopNamed(added.stops, "a").hotels[0].id;
    expect(stopNamed(added.stops, "a").hotels[0]).toMatchObject({ latitude: 35.2, longitude: -101.8 });

    const moved = applyOperations({ stops: added.stops, preferences: DEFAULT_PREFERENCES }, [{ type: "update_hotel", stopId: "a", hotelId, latitude: null, longitude: null }]);
    expect(stopNamed(moved.stops, "a").hotels[0]).toMatchObject({ latitude: null, longitude: null });
  });

  it("refuses hotels on a stop that is not an overnight stop", () => {
    expect(() =>
      applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "add_hotel", stopId: "lunch", name: "Inn", nights: 1 }]),
    ).toThrow(/Hotels can only be added to an overnight stop/);
  });

  it("turns a stop into an overnight stop with update_stop", () => {
    const result = applyOperations({ stops: baseStops(), preferences: DEFAULT_PREFERENCES }, [{ type: "update_stop", stopId: "lunch", overnight: true }]);
    expect(stopNamed(result.stops, "lunch").overnight).toBe(true);
  });
});

describe("geo helpers", () => {
  it("computes great-circle distance within expected tolerance", () => {
    const austinToDallas = haversineMeters([-97.7431, 30.2672], [-96.797, 32.7767]);
    expect(austinToDallas / 1000).toBeGreaterThan(290);
    expect(austinToDallas / 1000).toBeLessThan(310);
  });

  it("samples lines keeping endpoints", () => {
    const line = Array.from({ length: 100 }, (_, i): [number, number] => [i, 0]);
    const sampled = sampleLine(line, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toEqual([0, 0]);
    expect(sampled[4]).toEqual([99, 0]);
  });
});

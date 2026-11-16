import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { buildItineraryCsv } from "@/server/exporters";
import type { TripView } from "@/server/tripService";

const stop = (id: string, name: string, stopType: string, latitude: number, longitude: number) => ({
  id, name, address: `${name} address`, latitude, longitude, sequence: 0, stopType, source: "user", notes: "", visitMinutes: 60, hotels: [], dayTrips: [],
});

const lubbock = {
  ...stop("b", "Lubbock", "optional", 33.58, -101.9),
  hotels: [{ id: "h", name: "Lubbock Inn", address: "1 Main St, Lubbock", nights: 1 }],
  dayTrips: [{ id: "t", name: "Pagosa Peak", address: "Pagosa Peak address", latitude: 37.2, longitude: -107.0, dayIndex: 1, notes: "Bring water" }],
};

const view = {
  stops: [stop("a", "Austin", "origin", 30.27, -97.74), lubbock, stop("c", "Durango", "destination", 37.29, -107.88)],
  legs: [
    { fromStopId: "a", toStopId: "b", distanceMeters: 609800, durationSeconds: 23400, provider: "x", status: "ok", geometry: [] },
    { fromStopId: "b", toStopId: "c", distanceMeters: 803900, durationSeconds: 30000, provider: "x", status: "missing", geometry: [] },
  ],
  itinerary: {
    days: [
      {
        dayNumber: 1, date: "2026-12-23", kind: "driving", startStopId: "a", overnightStopId: "b",
        items: [
          { stopId: "a", fromPrevious: null, visitMinutes: 0, visitMinutesIsEstimate: false },
          { stopId: "b", fromPrevious: { distanceMeters: 609800, durationSeconds: 23400, status: "ok" }, visitMinutes: 60, visitMinutesIsEstimate: true },
        ],
      },
      {
        dayNumber: 2, date: "2026-12-24", kind: "driving", startStopId: "b", overnightStopId: null,
        dayTrip: { id: "t", name: "Pagosa Peak", notes: "Bring water", distanceMeters: 16093.44, durationSeconds: 5400, status: "ok" },
        items: [
          { stopId: "b", fromPrevious: null, visitMinutes: 60, visitMinutesIsEstimate: true },
          { stopId: "c", fromPrevious: { distanceMeters: 803900, durationSeconds: 30000, status: "missing" }, visitMinutes: 60, visitMinutesIsEstimate: true },
        ],
      },
    ],
  },
} as unknown as TripView;

describe("itinerary CSV export", () => {
  const rows = parse(buildItineraryCsv(view, new Date("2026-11-10T00:00:00Z")), { columns: true }) as Record<string, string>[];

  it("writes one row per driving leg with a start and an end location", () => {
    const legs = rows.filter((row) => row.leg !== "Day trip");
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ day: "1", date: "2026-12-23", leg: "1", start_location: "Austin", end_location: "Lubbock", overnight: "yes" });
    expect(legs[1]).toMatchObject({ day: "2", leg: "2", start_location: "Lubbock", end_location: "Durango", overnight: "no" });
    expect(Object.keys(legs[0])).toEqual([
      "day", "date", "leg", "start_location", "end_location", "drive_miles", "drive_time", "overnight",
      "hotels", "hotel_address", "day_trip_address", "notes", "generated_at",
    ]);
  });

  it("puts the overnight stop's hotel name and address on the leg that ends there", () => {
    expect(rows[0]).toMatchObject({ hotels: "Lubbock Inn", hotel_address: "1 Main St, Lubbock" });
    expect(rows[1]).toMatchObject({ hotels: "", hotel_address: "" });
  });

  it("writes each day trip as its own row on the day it belongs to", () => {
    expect(rows[2]).toMatchObject({
      day: "2", leg: "Day trip", start_location: "Lubbock", end_location: "Pagosa Peak", day_trip_address: "Pagosa Peak address", notes: "Bring water",
    });
    expect(rows[2].drive_time).toMatch(/1 h 30 min/);
  });

  it("does not repeat a stop as a separate row when it is the start of the next day", () => {
    const lubbockRows = rows.filter((row) => row.leg !== "Day trip" && (row.end_location === "Lubbock" || row.start_location === "Lubbock"));
    expect(lubbockRows).toHaveLength(2);
    expect(rows.filter((row) => row.leg !== "Day trip" && row.end_location === "Lubbock")).toHaveLength(1);
  });

  it("leaves drive figures blank for a leg that could not be calculated", () => {
    expect(rows[0].drive_miles).toBe("378.9");
    expect(rows[1]).toMatchObject({ leg: "2", drive_miles: "", drive_time: "" });
    expect(rows[0].drive_time).toMatch(/h/);
  });
});

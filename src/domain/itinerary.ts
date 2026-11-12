import type { Stop, TripPreferences } from "./trip";
import { sortStops } from "./trip";

/** Used when a stop has no visit duration. The UI labels these values as estimates. */
export const DEFAULT_VISIT_MINUTES = 60;
const PACKED_DAY_MINUTES = 12 * 60;

export type LegMetrics = { distanceMeters: number; durationSeconds: number; provider: string; status: "ok" | "missing" };

export type ItineraryItem = {
  stopId: string;
  name: string;
  stopType: Stop["stopType"];
  source: Stop["source"];
  /** Driving from the previous stop. Null for the first stop of a day that starts here. */
  fromPrevious: { distanceMeters: number; durationSeconds: number; status: "ok" | "missing" } | null;
  visitMinutes: number;
  visitMinutesIsEstimate: boolean;
};

export type ItineraryDay = {
  dayNumber: number;
  date: string | null;
  kind: "driving" | "rest";
  startStopId: string | null;
  overnightStopId: string | null;
  items: ItineraryItem[];
  driveDistanceMeters: number;
  driveDurationSeconds: number;
  visitMinutes: number;
  warnings: string[];
};

export type ItineraryResult = {
  /** Driving times come from the routing provider and exclude breaks, traffic and stop time. */
  provisional: true;
  days: ItineraryDay[];
  warnings: string[];
  totals: { distanceMeters: number; driveDurationSeconds: number; visitMinutes: number; drivingDays: number };
};

export type BuildItineraryInput = {
  stops: Stop[];
  legs: LegMetrics[];
  preferences: Pick<TripPreferences, "maxDailyDriveMinutes">;
  durationDays: number | null;
  startDate: string | null;
};

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function visitFor(stop: Stop) {
  if (stop.stopType === "origin" || stop.stopType === "return") return { minutes: 0, estimate: false };
  if (stop.visitMinutes === null) return { minutes: DEFAULT_VISIT_MINUTES, estimate: true };
  return { minutes: stop.visitMinutes, estimate: false };
}

function makeItem(stop: Stop, leg: LegMetrics | null): ItineraryItem {
  const visit = visitFor(stop);
  return {
    stopId: stop.id,
    name: stop.name,
    stopType: stop.stopType,
    source: stop.source,
    fromPrevious: leg ? { distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, status: leg.status } : null,
    visitMinutes: visit.minutes,
    visitMinutesIsEstimate: visit.estimate,
  };
}

/**
 * Splits the ordered route into driving days. A new day starts at the last stop reached
 * before the daily driving limit would be exceeded; that stop becomes the overnight stop.
 * Pure function: no I/O, so it is unit-tested directly.
 */
export function buildItinerary(input: BuildItineraryInput): ItineraryResult {
  const stops = sortStops(input.stops);
  const limitSeconds = input.preferences.maxDailyDriveMinutes * 60;
  const globalWarnings: string[] = [];
  const days: ItineraryDay[] = [];

  if (stops.length === 0) {
    return { provisional: true, days: [], warnings: [], totals: { distanceMeters: 0, driveDurationSeconds: 0, visitMinutes: 0, drivingDays: 0 } };
  }

  const newDay = (startStop: Stop | null): ItineraryDay => ({
    dayNumber: days.length + 1,
    date: input.startDate ? addDays(input.startDate, days.length) : null,
    kind: "driving",
    startStopId: startStop?.id ?? null,
    overnightStopId: null,
    items: startStop ? [makeItem(startStop, null)] : [],
    driveDistanceMeters: 0,
    driveDurationSeconds: 0,
    visitMinutes: startStop ? visitFor(startStop).minutes : 0,
    warnings: [],
  });

  let current = newDay(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i];
    const leg = input.legs[i - 1] ?? { distanceMeters: 0, durationSeconds: 0, provider: "none", status: "missing" as const };
    const dayHasDriving = current.driveDurationSeconds > 0;
    if (dayHasDriving && current.driveDurationSeconds + leg.durationSeconds > limitSeconds) {
      const previous = stops[i - 1];
      current.overnightStopId = previous.id;
      days.push(current);
      current = newDay(previous);
    }
    current.items.push(makeItem(stop, leg));
    current.driveDistanceMeters += leg.distanceMeters;
    current.driveDurationSeconds += leg.durationSeconds;
    current.visitMinutes += visitFor(stop).minutes;
    if (leg.status === "missing") current.warnings.push(`Route to "${stop.name}" is not calculated yet.`);
    // A stop marked as an overnight stop ends that day's driving here, unless it is the final stop.
    if (stop.overnight && i < stops.length - 1) {
      current.overnightStopId = stop.id;
      days.push(current);
      current = newDay(stop);
    }
  }
  days.push(current);

  if (input.durationDays !== null) {
    const extra = input.durationDays - days.length;
    if (extra > 0) {
      const last = days[days.length - 1];
      const destination = stops[stops.length - 1];
      for (let n = 0; n < extra; n++) {
        days.push({ ...newDay(destination), kind: "rest", items: [], visitMinutes: 0, dayNumber: days.length + 1 });
      }
      last.overnightStopId = destination.id;
    } else if (extra < 0) {
      globalWarnings.push(
        `This route needs ${days.length} driving days, but the trip is ${input.durationDays} day${input.durationDays === 1 ? "" : "s"}. ` +
          `Options: extend the trip, raise the daily driving limit, or remove or move stops.`,
      );
    }
  }

  days.forEach((day, index) => {
    if (index === days.length - 1 && day.kind === "driving") day.overnightStopId = null;
    if (day.driveDurationSeconds > limitSeconds) day.warnings.push("Driving exceeds your daily limit on this day.");
    if (day.driveDurationSeconds + day.visitMinutes * 60 > PACKED_DAY_MINUTES) day.warnings.push("This day looks packed: driving plus estimated visit time is over 12 hours.");
    globalWarnings.push(...day.warnings.map((warning) => `Day ${day.dayNumber}: ${warning}`));
  });

  const totals = days.reduce(
    (acc, day) => ({
      distanceMeters: acc.distanceMeters + day.driveDistanceMeters,
      driveDurationSeconds: acc.driveDurationSeconds + day.driveDurationSeconds,
      visitMinutes: acc.visitMinutes + day.visitMinutes,
      drivingDays: acc.drivingDays + (day.driveDurationSeconds > 0 ? 1 : 0),
    }),
    { distanceMeters: 0, driveDurationSeconds: 0, visitMinutes: 0, drivingDays: 0 },
  );

  return { provisional: true, days, warnings: globalWarnings, totals };
}

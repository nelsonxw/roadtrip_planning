import { chooseOvernightStops, cumulativeMeters, DEFAULT_MIN_POPULATION, drivingDaysNeeded, MAX_DETOUR_METERS, MAX_FRACTION_OFFSET, projectFraction, type Settlement } from "@/domain/overnight";
import { distanceToLineMeters, haversineMeters, type LngLat } from "@/domain/geo";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getServices, type Services } from "@/services/providers";
import { WikidataPopulation } from "@/services/population/wikidata";
import { applyTripChange, getTripView, type TripView } from "./tripService";

/** A settlement is ignored when it is this close to a stop already on the trip. */
const DUPLICATE_RADIUS_METERS = 5000;
const SEARCH_RADIUS_METERS = 30000;
/** Population lookups are limited per request, so a long trip makes a bounded number of Wikidata calls. */
const PER_BREAK_LOOKUPS = 8;

/** Distance along the route (as a fraction) from a point to the nearest planned break. */
function nearestBreakDistance(fraction: number, days: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let afterDay = 1; afterDay < days; afterDay++) best = Math.min(best, Math.abs(fraction - afterDay / days));
  return best;
}

export type OvernightSuggestionView = {
  afterDay: number;
  settlement: { id: string; name: string; latitude: number; longitude: number; detourMiles: number; population: number };
};

export type OvernightPlan = {
  needed: boolean;
  days: number;
  minPopulation: number;
  suggestions: OvernightSuggestionView[];
  /** Shown to the user, so they know what the suggestion is based on and when it cannot be made. */
  note: string;
};

let populationSource: WikidataPopulation | null = null;
function populationLookup(): WikidataPopulation {
  populationSource ??= new WikidataPopulation(env.WIKIMEDIA_USER_AGENT);
  return populationSource;
}

/** Finds an overnight stop for each driving day of a long trip, from towns with a known population along the route. */
export async function planOvernightStops(tripId: string, ownerId: string, services: Services = getServices(), minPopulation = DEFAULT_MIN_POPULATION): Promise<OvernightPlan> {
  const view = await getTripView(tripId, ownerId, services);
  const limitSeconds = view.preferences.maxDailyDriveMinutes * 60;
  const days = drivingDaysNeeded(view.itinerary.totals.driveDurationSeconds, limitSeconds);
  const base = { days, minPopulation };
  if (days <= 1 || view.routeGeometry.length < 2) return { ...base, needed: false, suggestions: [], note: "This trip fits in one driving day, so no overnight stop is needed." };
  if (!services.places.searchSettlements) return { ...base, needed: true, suggestions: [], note: "Overnight suggestions are not available with the current places provider." };

  const found = await services.places.searchSettlements(view.routeGeometry, SEARCH_RADIUS_METERS);
  const cumulative = cumulativeMeters(view.routeGeometry);
  const existing = view.stops.map((stop) => [stop.longitude, stop.latitude] as LngLat);
  const withBreak = found
    .filter((place) => !existing.some((point) => haversineMeters(point, [place.longitude, place.latitude]) < DUPLICATE_RADIUS_METERS))
    .map((place) => ({
      place,
      fraction: projectFraction([place.longitude, place.latitude], view.routeGeometry, cumulative),
      detourMeters: Math.round(distanceToLineMeters([place.longitude, place.latitude], view.routeGeometry)),
    }))
    .filter((item) => item.detourMeters <= MAX_DETOUR_METERS)
    .filter((item) => nearestBreakDistance(item.fraction, days) <= MAX_FRACTION_OFFSET);
  // Each planned night gets its own closest candidates, so one break cannot use up the whole lookup budget.
  const seen = new Set<string>();
  const near: typeof withBreak = [];
  for (let afterDay = 1; afterDay < days; afterDay++) {
    const target = afterDay / days;
    const forBreak = withBreak
      .filter((item) => Math.abs(item.fraction - target) <= MAX_FRACTION_OFFSET)
      .sort((a, b) => Math.abs(a.fraction - target) - Math.abs(b.fraction - target))
      .slice(0, PER_BREAK_LOOKUPS);
    for (const item of forBreak) {
      if (seen.has(item.place.externalId)) continue;
      seen.add(item.place.externalId);
      near.push(item);
    }
  }

  const settlements: Settlement[] = [];
  for (const item of near) {
    const inhabitants = await populationLookup().populationOf(item.place.name, item.place.region);
    settlements.push({ id: item.place.externalId, name: item.place.name, latitude: item.place.latitude, longitude: item.place.longitude, fraction: item.fraction, detourMeters: item.detourMeters, population: inhabitants });
  }

  const overnightFractions = view.stops
    .filter((stop) => stop.overnight)
    .map((stop) => projectFraction([stop.longitude, stop.latitude], view.routeGeometry, cumulative));
  const chosen = chooseOvernightStops(view.itinerary.totals.driveDurationSeconds, limitSeconds, settlements, minPopulation, overnightFractions);
  const suggestions = chosen.map((item) => ({
    afterDay: item.afterDay,
    settlement: {
      id: item.settlement.id,
      name: item.settlement.name,
      latitude: item.settlement.latitude,
      longitude: item.settlement.longitude,
      detourMiles: Math.round((item.settlement.detourMeters / 1609.344) * 10) / 10,
      population: item.settlement.population ?? 0,
    },
  }));
  const note = suggestions.length
    ? `Towns with at least ${minPopulation.toLocaleString("en-US")} people, population from Wikidata.`
    : `No towns with at least ${minPopulation.toLocaleString("en-US")} people (from Wikidata) were found near the planned breaks. Try a lower minimum.`;
  return { ...base, needed: true, suggestions, note };
}

/** Where a new stop belongs: on the return leg if it falls after the destination along the route, otherwise outbound at its place in order. */
export function legPlacement(view: TripView, latitude: number, longitude: number): { leg: "outbound" | "return"; index: number } {
  const cumulative = cumulativeMeters(view.routeGeometry);
  const fractionOf = (lng: number, lat: number) => projectFraction([lng, lat], view.routeGeometry, cumulative);
  const destination = view.stops.find((stop) => stop.stopType === "destination");
  const destinationFraction = destination ? fractionOf(destination.longitude, destination.latitude) : 1;
  const target = fractionOf(longitude, latitude);
  if (target > destinationFraction) {
    const inbound = view.stops.filter((stop) => stop.sequence > (destination?.sequence ?? 0) && stop.stopType !== "return");
    const index = inbound.filter((stop) => fractionOf(stop.longitude, stop.latitude) < target).length;
    return { leg: "return", index };
  }
  const outbound = view.stops.filter((stop) => stop.stopType === "required" || stop.stopType === "optional").filter((stop) => fractionOf(stop.longitude, stop.latitude) < destinationFraction);
  const index = outbound.filter((stop) => fractionOf(stop.longitude, stop.latitude) < target).length;
  return { leg: "outbound", index };
}

export async function acceptOvernightSuggestion(input: { tripId: string; ownerId: string; expectedVersion: number; name: string; latitude: number; longitude: number; address?: string }, services: Services = getServices()) {
  const view = await getTripView(input.tripId, input.ownerId, services);
  if (view.version !== input.expectedVersion) throw new AppError(409, "version_conflict", "This trip changed in another window. Reload to see the latest version.");
  const placement = legPlacement(view, input.latitude, input.longitude);
  await applyTripChange({
    tripId: input.tripId,
    ownerId: input.ownerId,
    expectedVersion: input.expectedVersion,
    summary: `Added overnight stop ${input.name}`,
    operations: [
      {
        type: "add_stop",
        name: input.name,
        address: input.address ?? "",
        latitude: input.latitude,
        longitude: input.longitude,
        stopType: "optional",
        leg: placement.leg,
        index: placement.index,
        source: "poi",
        notes: "Suggested overnight stop",
        visitMinutes: null,
      },
    ],
  });
  return getTripView(input.tripId, input.ownerId, services);
}

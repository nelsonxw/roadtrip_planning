import { chooseOvernightStops, cumulativeMeters, drivingDaysNeeded, projectFraction, type Settlement } from "@/domain/overnight";
import { distanceToLineMeters, haversineMeters, type LngLat } from "@/domain/geo";

import { AppError } from "@/lib/errors";
import { getServices, type Services } from "@/services/providers";
import { applyTripChange, getTripView, type TripView } from "./tripService";

/** A settlement is ignored when it is this close to a stop already on the trip. */
const DUPLICATE_RADIUS_METERS = 5000;
const SEARCH_RADIUS_METERS = 30000;

export type OvernightSuggestionView = {
  afterDay: number;
  settlement: { id: string; name: string; kind: Settlement["kind"]; latitude: number; longitude: number; detourKm: number };
};

export type OvernightPlan = {
  needed: boolean;
  days: number;
  suggestions: OvernightSuggestionView[];
  /** Shown to the user, so they know what the suggestion is based on and when it cannot be made. */
  note: string;
};

const SIZE_NOTE = "Size is based on place type (city, town or village). Population is not available from this data source.";

/** Finds a sensible overnight stop for each driving day of a long trip, using real settlements along the route. */
export async function planOvernightStops(tripId: string, ownerId: string, services: Services = getServices()): Promise<OvernightPlan> {
  const view = await getTripView(tripId, ownerId, services);
  const days = drivingDaysNeeded(view.itinerary.totals.driveDurationSeconds, view.preferences.maxDailyDriveMinutes * 60);
  if (days <= 1 || view.routeGeometry.length < 2) return { needed: false, days, suggestions: [], note: "This trip fits in one driving day, so no overnight stop is needed." };
  if (!services.places.searchSettlements) return { needed: true, days, suggestions: [], note: "Overnight suggestions are not available with the current places provider." };

  const settlements = await services.places.searchSettlements(view.routeGeometry, SEARCH_RADIUS_METERS);
  const cumulative = cumulativeMeters(view.routeGeometry);
  const existing = view.stops.map((stop) => [stop.longitude, stop.latitude] as LngLat);
  const candidates: Settlement[] = settlements
    .filter((place) => !existing.some((point) => haversineMeters(point, [place.longitude, place.latitude]) < DUPLICATE_RADIUS_METERS))
    .map((place) => ({
      id: place.externalId,
      name: place.name,
      kind: place.kind,
      latitude: place.latitude,
      longitude: place.longitude,
      fraction: projectFraction([place.longitude, place.latitude], view.routeGeometry, cumulative),
      detourMeters: Math.round(distanceToLineMeters([place.longitude, place.latitude], view.routeGeometry)),
    }));

  const chosen = chooseOvernightStops(view.itinerary.totals.driveDurationSeconds, view.preferences.maxDailyDriveMinutes * 60, candidates);
  return {
    needed: true,
    days,
    suggestions: chosen.map((item) => ({
      afterDay: item.afterDay,
      settlement: { id: item.settlement.id, name: item.settlement.name, kind: item.settlement.kind, latitude: item.settlement.latitude, longitude: item.settlement.longitude, detourKm: Math.round(item.settlement.detourMeters / 100) / 10 },
    })),
    note: SIZE_NOTE,
  };
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

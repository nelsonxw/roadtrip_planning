import { createHash, randomUUID } from "node:crypto";
import type { Prisma, Stop as StopRow, Trip as TripRow, PlaceRecommendation as PlaceRow } from "@prisma/client";
import { buildItinerary, type ItineraryResult, type LegMetrics } from "@/domain/itinerary";
import { type LngLat } from "@/domain/geo";
import { applyOperations, DEFAULT_PREFERENCES, makeReturnStop, renumber, sortStops, type Stop, type TripOperation, type TripPreferences } from "@/domain/trip";
import { db } from "@/lib/db";
import { AppError, ProviderError } from "@/lib/errors";
import { getServices, type Services } from "@/services/providers";
import type { RouteLeg } from "@/services/types";

export type RouteLegView = LegMetrics & { fromStopId: string; toStopId: string; geometry: LngLat[] };

export type PlaceView = {
  id: string;
  externalId: string;
  name: string;
  category: string;
  description: string;
  address: string;
  latitude: number;
  longitude: number;
  source: string;
  sourceUrl: string | null;
  image: { url: string; attribution: string; license: string; sourceUrl: string | null } | null;
  visitMinutes: number | null;
  visitMinutesIsEstimate: true;
  detourDistanceMeters: number | null;
  status: string;
  stopId: string | null;
};

export type TripView = {
  id: string;
  name: string;
  notes: string;
  startDate: string | null;
  durationDays: number | null;
  preferences: TripPreferences;
  version: number;
  stops: Stop[];
  legs: RouteLegView[];
  routeErrors: string[];
  routeGeometry: LngLat[];
  places: PlaceView[];
  itinerary: ItineraryResult;
  modes: Services["modes"];
  updatedAt: string;
};

type Endpoint = { name: string; address?: string; latitude: number; longitude: number };

const toDateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

function toStop(row: StopRow): Stop {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    sequence: row.sequence,
    stopType: row.stopType as Stop["stopType"],
    source: row.source as Stop["source"],
    notes: row.notes,
    visitMinutes: row.visitMinutes,
  };
}

function toPreferences(value: Prisma.JsonValue): TripPreferences {
  return { ...DEFAULT_PREFERENCES, ...(value as Partial<TripPreferences>) };
}

function toPlaceView(row: PlaceRow): PlaceView {
  const hasImage = Boolean(row.imageUrl && row.imageAttribution && row.imageLicense);
  return {
    id: row.id,
    externalId: row.externalId,
    name: row.name,
    category: row.category,
    description: row.description,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    source: row.source,
    sourceUrl: row.sourceUrl,
    image: hasImage ? { url: row.imageUrl!, attribution: row.imageAttribution!, license: row.imageLicense!, sourceUrl: row.imageSourceUrl } : null,
    visitMinutes: row.visitMinutes,
    visitMinutesIsEstimate: true,
    detourDistanceMeters: row.detourDistanceMeters,
    status: row.status,
    stopId: row.stopId,
  };
}

/** Route legs are cached by coordinates and routing options, so legs untouched by an edit are never recalculated. */
function routeCacheKey(provider: string, from: LngLat, to: LngLat, preferences: TripPreferences) {
  const payload = JSON.stringify({ provider, pref: preferences.routePreference, avoid: [...preferences.avoid].sort(), from: from.map((n) => n.toFixed(5)), to: to.map((n) => n.toFixed(5)) });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getRouteLeg(from: LngLat, to: LngLat, preferences: TripPreferences, services = getServices()): Promise<RouteLeg> {
  const key = routeCacheKey(services.routing.provider, from, to, preferences);
  const cached = await db.routeCache.findUnique({ where: { key } });
  if (cached) {
    return {
      distanceMeters: cached.distanceMeters,
      durationSeconds: cached.durationSeconds,
      geometry: cached.geometry as LngLat[],
      provider: cached.provider,
      mode: services.routing.mode,
    };
  }
  const leg = await services.routing.route(from, to, { preference: preferences.routePreference, avoid: preferences.avoid });
  await db.routeCache.upsert({
    where: { key },
    create: { key, provider: leg.provider, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, geometry: leg.geometry },
    update: {},
  });
  return leg;
}

/** Computes every consecutive leg. A failing leg is reported, never silently replaced with an estimate. */
export async function computeLegs(stops: Stop[], preferences: TripPreferences, services = getServices()) {
  const ordered = sortStops(stops);
  const errors: string[] = [];
  const legs: RouteLegView[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    try {
      const leg = await getRouteLeg([from.longitude, from.latitude], [to.longitude, to.latitude], preferences, services);
      legs.push({ fromStopId: from.id, toStopId: to.id, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, provider: leg.provider, status: "ok", geometry: leg.geometry });
    } catch (error) {
      const message =
        error instanceof ProviderError && error.kind === "not_found"
          ? `No road found near ${from.name} or ${to.name}. Move that stop to a nearby road or town, then retry.`
          : error instanceof ProviderError
            ? error.message
            : "The route for this leg could not be calculated.";
      errors.push(`${from.name} to ${to.name}: ${message}`);
      legs.push({ fromStopId: from.id, toStopId: to.id, distanceMeters: 0, durationSeconds: 0, provider: "none", status: "missing", geometry: [] });
    }
  }
  return { legs, errors };
}

export async function loadOwnedTrip(tripId: string, ownerId: string): Promise<TripRow> {
  const trip = await db.trip.findFirst({ where: { id: tripId, ownerId } });
  if (!trip) throw new AppError(404, "trip_not_found", "Trip not found.");
  return trip;
}

export async function listTripsForOwner(ownerId: string) {
  const trips = await db.trip.findMany({ where: { ownerId }, orderBy: { updatedAt: "desc" }, include: { stops: { select: { id: true } } } });
  return trips.map((trip) => ({
    id: trip.id,
    name: trip.name,
    startDate: toDateOnly(trip.startDate),
    durationDays: trip.durationDays,
    stopCount: trip.stops.length,
    updatedAt: trip.updatedAt.toISOString(),
  }));
}

export async function createTrip(ownerId: string, input: { name: string; notes?: string; startDate?: string | null; durationDays?: number | null; roundTrip?: boolean; origin: Endpoint; destination: Endpoint }) {
  const id = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.trip.create({
      data: {
        id,
        ownerId,
        name: input.name,
        notes: input.notes ?? "",
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
        durationDays: input.durationDays ?? null,
        preferences: DEFAULT_PREFERENCES as unknown as Prisma.InputJsonValue,
      },
    });
    const endpoints: [Endpoint, Stop["stopType"]][] = [
      [input.origin, "origin"],
      [input.destination, "destination"],
    ];
    const stops: Stop[] = endpoints.map(([endpoint, stopType], sequence) => ({
      id: randomUUID(),
      name: endpoint.name,
      address: endpoint.address ?? "",
      latitude: endpoint.latitude,
      longitude: endpoint.longitude,
      sequence,
      stopType,
      source: "user",
      notes: "",
      visitMinutes: null,
    }));
    const allStops = input.roundTrip ? renumber([...stops, makeReturnStop(stops[0])]) : stops;
    for (const stop of allStops) await tx.stop.create({ data: { ...stop, tripId: id } });
    await tx.tripRevision.create({
      data: { tripId: id, revisionNumber: 1, summary: "Trip created", snapshot: { stops: allStops, preferences: DEFAULT_PREFERENCES } as unknown as Prisma.InputJsonValue },
    });
  });
  return id;
}

export async function getTripView(tripId: string, ownerId: string, services = getServices()): Promise<TripView> {
  const trip = await loadOwnedTrip(tripId, ownerId);
  const [stopRows, placeRows] = await Promise.all([
    db.stop.findMany({ where: { tripId }, orderBy: { sequence: "asc" } }),
    db.placeRecommendation.findMany({ where: { tripId }, orderBy: [{ detourDistanceMeters: "asc" }, { name: "asc" }] }),
  ]);
  const preferences = toPreferences(trip.preferences);
  const stops = sortStops(stopRows.map(toStop));
  const { legs, errors } = await computeLegs(stops, preferences, services);
  const routeGeometry = legs.flatMap((leg) => leg.geometry);
  const legMetrics = legs.map(({ distanceMeters, durationSeconds, provider, status }) => ({ distanceMeters, durationSeconds, provider, status }));
  const itinerary = buildItinerary({ stops, legs: legMetrics, preferences, durationDays: trip.durationDays, startDate: toDateOnly(trip.startDate) });

  return {
    id: trip.id,
    name: trip.name,
    notes: trip.notes,
    startDate: toDateOnly(trip.startDate),
    durationDays: trip.durationDays,
    preferences,
    version: trip.version,
    stops,
    legs,
    routeErrors: errors,
    routeGeometry,
    places: placeRows.map(toPlaceView),
    itinerary,
    modes: services.modes,
    updatedAt: trip.updatedAt.toISOString(),
  };
}

/**
 * Applies typed operations atomically. The version check and increment happen in one
 * conditional update, so two tabs (or the AI and the user) cannot both apply the same base version.
 */
export async function applyTripChange(input: { tripId: string; ownerId: string; expectedVersion: number; operations: TripOperation[]; summary: string }) {
  await loadOwnedTrip(input.tripId, input.ownerId);
  await db.$transaction(async (tx) => {
    const bumped = await tx.trip.updateMany({
      where: { id: input.tripId, ownerId: input.ownerId, version: input.expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (bumped.count === 0) {
      throw new AppError(409, "version_conflict", "This trip changed in another window. Reload to see the latest version, then try again.");
    }
    const current = await tx.stop.findMany({ where: { tripId: input.tripId } });
    const tripRow = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
    const before = { stops: sortStops(current.map(toStop)), preferences: toPreferences(tripRow.preferences) };
    const result = applyOperations(before, input.operations);

    const keptIds = result.stops.map((stop) => stop.id);
    const removedIds = current.map((row) => row.id).filter((id) => !keptIds.includes(id));
    if (removedIds.length) {
      await tx.placeRecommendation.updateMany({ where: { stopId: { in: removedIds } }, data: { status: "suggested", stopId: null } });
      await tx.stop.deleteMany({ where: { id: { in: removedIds } } });
    }
    for (const stop of result.stops) {
      const data = {
        name: stop.name,
        address: stop.address,
        latitude: stop.latitude,
        longitude: stop.longitude,
        sequence: stop.sequence,
        stopType: stop.stopType,
        source: stop.source,
        notes: stop.notes,
        visitMinutes: stop.visitMinutes,
      };
      await tx.stop.upsert({ where: { id: stop.id }, create: { id: stop.id, tripId: input.tripId, ...data }, update: data });
    }
    await linkPlacesToNewStops(tx, input.tripId, input.operations, result.createdStopIds);
    await tx.trip.update({
      where: { id: input.tripId },
      data: { preferences: result.preferences as unknown as Prisma.InputJsonValue },
    });

    const revisionCount = await tx.tripRevision.count({ where: { tripId: input.tripId } });
    await tx.tripRevision.create({
      data: {
        tripId: input.tripId,
        revisionNumber: revisionCount + 1,
        summary: input.summary,
        snapshot: { stops: result.stops, preferences: result.preferences } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

async function linkPlacesToNewStops(tx: Prisma.TransactionClient, tripId: string, operations: TripOperation[], createdStopIds: Record<number, string>) {
  for (const [index, operation] of operations.entries()) {
    if (operation.type !== "add_stop" || !operation.placeId) continue;
    const stopId = createdStopIds[index];
    const linked = await tx.placeRecommendation.updateMany({
      where: { id: operation.placeId, tripId },
      data: { status: "added", stopId },
    });
    if (linked.count === 0) throw new AppError(404, "place_not_found", "That recommendation no longer exists.");
  }
}

export async function updateTripDetails(input: { tripId: string; ownerId: string; expectedVersion: number; name?: string; notes?: string; startDate?: string | null; durationDays?: number | null }) {
  await loadOwnedTrip(input.tripId, input.ownerId);
  const updated = await db.trip.updateMany({
    where: { id: input.tripId, ownerId: input.ownerId, version: input.expectedVersion },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null } : {}),
      ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) throw new AppError(409, "version_conflict", "This trip changed in another window. Reload to see the latest version.");
}

/** Restores the state from before the most recent change. The restore itself is recorded as a new revision. */
export async function undoLastChange(input: { tripId: string; ownerId: string; expectedVersion: number }) {
  await loadOwnedTrip(input.tripId, input.ownerId);
  const revisions = await db.tripRevision.findMany({ where: { tripId: input.tripId }, orderBy: { revisionNumber: "desc" }, take: 2 });
  const [latest, previous] = revisions;
  if (!latest || !previous || latest.revisionNumber === 1) throw new AppError(409, "nothing_to_undo", "There is no earlier change to undo.");
  const snapshot = previous.snapshot as unknown as { stops?: Stop[]; preferences?: TripPreferences };
  if (!snapshot.stops) throw new AppError(409, "nothing_to_undo", "There is no earlier change to undo.");
  const undone = snapshot.stops;
  await db.$transaction(async (tx) => {
    const bumped = await tx.trip.updateMany({ where: { id: input.tripId, version: input.expectedVersion }, data: { version: { increment: 1 } } });
    if (bumped.count === 0) throw new AppError(409, "version_conflict", "This trip changed in another window. Reload and try again.");
    const currentIds = (await tx.stop.findMany({ where: { tripId: input.tripId }, select: { id: true } })).map((row) => row.id);
    const restoredIds = undone.map((stop) => stop.id);
    const removed = currentIds.filter((id) => !restoredIds.includes(id));
    if (removed.length) {
      await tx.placeRecommendation.updateMany({ where: { stopId: { in: removed } }, data: { status: "suggested", stopId: null } });
      await tx.stop.deleteMany({ where: { id: { in: removed } } });
    }
    for (const stop of undone) {
      const data = { name: stop.name, address: stop.address, latitude: stop.latitude, longitude: stop.longitude, sequence: stop.sequence, stopType: stop.stopType, source: stop.source, notes: stop.notes, visitMinutes: stop.visitMinutes };
      await tx.stop.upsert({ where: { id: stop.id }, create: { id: stop.id, tripId: input.tripId, ...data }, update: data });
    }
    if (snapshot.preferences) await tx.trip.update({ where: { id: input.tripId }, data: { preferences: snapshot.preferences as unknown as Prisma.InputJsonValue } });
    const count = await tx.tripRevision.count({ where: { tripId: input.tripId } });
    await tx.tripRevision.create({ data: { tripId: input.tripId, revisionNumber: count + 1, summary: `Undid: ${latest.summary}`, snapshot: { stops: undone, preferences: snapshot.preferences } as unknown as Prisma.InputJsonValue } });
  });
}

export async function deleteTrip(tripId: string, ownerId: string) {
  await loadOwnedTrip(tripId, ownerId);
  await db.trip.delete({ where: { id: tripId } });
}

/** Deletes the chosen trips. Any ID that is not one of the owner's trips is refused, so nothing else is touched. */
export async function deleteTripsByIds(ownerId: string, tripIds: string[]) {
  const unique = [...new Set(tripIds)];
  const owned = await db.trip.count({ where: { ownerId, id: { in: unique } } });
  if (owned !== unique.length) throw new AppError(404, "trip_not_found", "One or more selected trips could not be found. Refresh the list and try again.");
  const result = await db.trip.deleteMany({ where: { ownerId, id: { in: unique } } });
  return result.count;
}

/** Trips that started before today. Trips with no start date are not historical, so they are kept. */
function historicalWhere(ownerId: string, today: Date): Prisma.TripWhereInput {
  return { ownerId, startDate: { lt: today } };
}

export async function countHistoricalTrips(ownerId: string, today = startOfUtcDay(new Date())) {
  return db.trip.count({ where: historicalWhere(ownerId, today) });
}

/**
 * Deletes the owner's historical trips. The caller passes the count the user confirmed, and the
 * delete is refused if the number has changed, so the user never removes trips they did not see.
 */
export async function deleteHistoricalTrips(ownerId: string, expectedCount: number, today = startOfUtcDay(new Date())) {
  const result = await db.$transaction(async (tx) => {
    const current = await tx.trip.count({ where: historicalWhere(ownerId, today) });
    if (current !== expectedCount) {
      throw new AppError(409, "count_changed", `The number of past trips changed (now ${current}). Review the list and try again.`);
    }
    return tx.trip.deleteMany({ where: historicalWhere(ownerId, today) });
  });
  return result.count;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function discoverPlaces(input: { tripId: string; ownerId: string; services?: Services }) {
  const services = input.services ?? getServices();
  const view = await getTripView(input.tripId, input.ownerId, services);
  if (view.routeGeometry.length < 2) throw new AppError(409, "no_route", "Calculate a route before searching for places.");
  const candidates = await services.places.searchAlongRoute(view.routeGeometry, { radiusMeters: 15000, maxResults: 25 });
  for (const place of candidates) {
    const data = {
      name: place.name,
      category: place.category,
      description: place.description,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      source: place.source,
      sourceUrl: place.sourceUrl,
      imageUrl: place.image?.url ?? null,
      imageSourceUrl: place.image?.sourceUrl ?? null,
      imageAttribution: place.image?.attribution ?? null,
      imageLicense: place.image?.license ?? null,
      reason: "Near your route",
      visitMinutes: place.visitMinutes,
      detourDistanceMeters: place.detourDistanceMeters,
    };
    await db.placeRecommendation.upsert({
      where: { tripId_externalId: { tripId: input.tripId, externalId: place.externalId } },
      create: { tripId: input.tripId, externalId: place.externalId, ...data },
      update: data,
    });
  }
  return getTripView(input.tripId, input.ownerId, services);
}

export async function setPlaceStatus(input: { tripId: string; ownerId: string; placeId: string; status: "suggested" | "saved" | "dismissed" }) {
  await loadOwnedTrip(input.tripId, input.ownerId);
  const place = await db.placeRecommendation.findFirst({ where: { id: input.placeId, tripId: input.tripId } });
  if (!place) throw new AppError(404, "place_not_found", "That recommendation no longer exists.");
  if (place.status === "added") throw new AppError(409, "place_in_itinerary", "Remove this stop from the itinerary before changing its status.");
  await db.placeRecommendation.update({ where: { id: place.id }, data: { status: input.status } });
}

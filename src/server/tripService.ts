import { createHash, randomUUID } from "node:crypto";
import type { DocumentData } from "firebase-admin/firestore";
import { buildItinerary, type DayTripLeg, type ItineraryResult, type LegMetrics } from "@/domain/itinerary";
import { type LngLat } from "@/domain/geo";
import { applyOperations, DEFAULT_PREFERENCES, makeReturnStop, renumber, sortStops, type DayTrip, type Hotel, type Stop, type TripOperation, type TripPreferences } from "@/domain/trip";
import { AppError, ProviderError } from "@/lib/errors";
import { getDb } from "@/lib/firestore";
import { getServices, type Services } from "@/services/providers";
import type { RouteLeg } from "@/services/types";

export type RouteLegView = LegMetrics & { fromStopId: string; toStopId: string; geometry: LngLat[] };

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
  /** Round-trip routes of the day trips, drawn separately from the route. */
  dayTripRoutes: { id: string; name: string; geometry: LngLat[] }[];
  itinerary: ItineraryResult;
  modes: Services["modes"];
  updatedAt: string;
};

type Endpoint = { name: string; address?: string; latitude: number; longitude: number };

type TripRecord = {
  id: string;
  ownerId: string;
  name: string;
  notes: string;
  startDate: Date | null;
  durationDays: number | null;
  preferences: unknown;
  version: number;
  updatedAt: Date;
};

const tripsRef = () => getDb().collection("trips");
const tripRef = (tripId: string) => tripsRef().doc(tripId);
const stopsRef = (tripId: string) => tripRef(tripId).collection("stops");
const revisionsRef = (tripId: string) => tripRef(tripId).collection("revisions");
const routeCacheRef = (key: string) => getDb().collection("routeCache").doc(key);

/** Revision IDs are zero-padded so they sort in the order they were made. */
const revisionId = (revisionNumber: number) => String(revisionNumber).padStart(6, "0");

const toDateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

const toDate = (value: unknown): Date | null => (value ? (value as { toDate(): Date }).toDate() : null);

function toTripRecord(id: string, data: DocumentData): TripRecord {
  return {
    id,
    ownerId: data.ownerId,
    name: data.name,
    notes: data.notes,
    startDate: toDate(data.startDate),
    durationDays: data.durationDays ?? null,
    preferences: data.preferences,
    version: data.version,
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

function toStop(id: string, data: DocumentData): Stop {
  return {
    id,
    name: data.name,
    address: data.address,
    latitude: data.latitude,
    longitude: data.longitude,
    sequence: data.sequence,
    stopType: data.stopType as Stop["stopType"],
    source: data.source as Stop["source"],
    notes: data.notes,
    visitMinutes: data.visitMinutes ?? null,
    overnight: data.overnight,
    hotels: (data.hotels ?? []) as Hotel[],
    dayTrips: (data.dayTrips ?? []) as DayTrip[],
  };
}

/** Firestore has no undefined values, so optional fields are written as null. */
function toStopData(stop: Stop) {
  return {
    name: stop.name,
    address: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    sequence: stop.sequence,
    stopType: stop.stopType,
    source: stop.source,
    notes: stop.notes,
    visitMinutes: stop.visitMinutes ?? null,
    overnight: stop.overnight,
    hotels: stop.hotels,
    dayTrips: stop.dayTrips,
  };
}

/** Snapshots and geometry are stored as JSON text, because Firestore does not allow arrays inside arrays. */
function revisionData(revisionNumber: number, summary: string, snapshot: unknown, createdAt: Date) {
  return { revisionNumber, summary, snapshot: JSON.stringify(snapshot), createdAt };
}

function toPreferences(value: unknown): TripPreferences {
  return { ...DEFAULT_PREFERENCES, ...(value as Partial<TripPreferences>) };
}

/** Route legs are cached by coordinates and routing options, so legs untouched by an edit are never recalculated. */
function routeCacheKey(provider: string, from: LngLat, to: LngLat, preferences: TripPreferences) {
  const payload = JSON.stringify({ provider, pref: preferences.routePreference, avoid: [...preferences.avoid].sort(), from: from.map((n) => n.toFixed(5)), to: to.map((n) => n.toFixed(5)) });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getRouteLeg(from: LngLat, to: LngLat, preferences: TripPreferences, services = getServices()): Promise<RouteLeg> {
  const key = routeCacheKey(services.routing.provider, from, to, preferences);
  const cached = await routeCacheRef(key).get();
  if (cached.exists) {
    const data = cached.data()!;
    return {
      distanceMeters: data.distanceMeters,
      durationSeconds: data.durationSeconds,
      geometry: JSON.parse(data.geometry) as LngLat[],
      provider: data.provider,
      mode: services.routing.mode,
    };
  }
  const leg = await services.routing.route(from, to, { preference: preferences.routePreference, avoid: preferences.avoid });
  await routeCacheRef(key).set({ provider: leg.provider, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, geometry: JSON.stringify(leg.geometry), createdAt: new Date() });
  return leg;
}

/** Round trip from each day trip's stop to its place and back. A failing trip is reported, never replaced with an estimate. */
export async function computeDayTrips(stops: Stop[], preferences: TripPreferences, services = getServices()) {
  const errors: string[] = [];
  const jobs = stops.flatMap((stop) => stop.dayTrips.map((trip) => ({ stop, trip })));
  const legs = await mapInBatches(jobs, async ({ stop, trip }): Promise<DayTripLeg> => {
    const here: LngLat = [stop.longitude, stop.latitude];
    const there: LngLat = [trip.longitude, trip.latitude];
    const base = { id: trip.id, stopId: stop.id, dayIndex: trip.dayIndex, name: trip.name, notes: trip.notes };
    try {
      const [out, back] = await Promise.all([getRouteLeg(here, there, preferences, services), getRouteLeg(there, here, preferences, services)]);
      return { ...base, distanceMeters: out.distanceMeters + back.distanceMeters, durationSeconds: out.durationSeconds + back.durationSeconds, status: "ok", geometry: [...out.geometry, ...back.geometry] };
    } catch {
      errors.push(`Day trip to ${trip.name} from ${stop.name}: the route could not be calculated.`);
      return { ...base, distanceMeters: 0, durationSeconds: 0, status: "missing", geometry: [] };
    }
  });
  return { legs, errors };
}

/** Route requests in flight at once. Enough to speed up a cold trip without tripping the routing provider's per-minute limit. */
const ROUTE_CONCURRENCY = 4;

/** Runs tasks a few at a time. Results keep the order of the input. */
async function mapInBatches<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += ROUTE_CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(i, i + ROUTE_CONCURRENCY).map(task))));
  }
  return results;
}

/** Computes every consecutive leg. A failing leg is reported, never silently replaced with an estimate. */
export async function computeLegs(stops: Stop[], preferences: TripPreferences, services = getServices()) {
  const ordered = sortStops(stops);
  const errors: string[] = [];
  const pairs = ordered.slice(0, -1).map((from, i) => ({ from, to: ordered[i + 1] }));
  const legs = await mapInBatches(pairs, async ({ from, to }): Promise<RouteLegView> => {
    try {
      const leg = await getRouteLeg([from.longitude, from.latitude], [to.longitude, to.latitude], preferences, services);
      return { fromStopId: from.id, toStopId: to.id, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, provider: leg.provider, status: "ok", geometry: leg.geometry };
    } catch (error) {
      const message =
        error instanceof ProviderError && error.kind === "not_found"
          ? `No road found near ${from.name} or ${to.name}. Move that stop to a nearby road or town, then retry.`
          : error instanceof ProviderError
            ? error.message
            : "The route for this leg could not be calculated.";
      errors.push(`${from.name} to ${to.name}: ${message}`);
      return { fromStopId: from.id, toStopId: to.id, distanceMeters: 0, durationSeconds: 0, provider: "none", status: "missing", geometry: [] };
    }
  });
  return { legs, errors };
}

export async function loadOwnedTrip(tripId: string, ownerId: string): Promise<TripRecord> {
  const snap = await tripRef(tripId).get();
  if (!snap.exists || snap.data()!.ownerId !== ownerId) throw new AppError(404, "trip_not_found", "Trip not found.");
  return toTripRecord(snap.id, snap.data()!);
}

export async function listTripsForOwner(ownerId: string) {
  const snaps = await tripsRef().where("ownerId", "==", ownerId).get();
  const trips = await Promise.all(
    snaps.docs.map(async (snap) => {
      const record = toTripRecord(snap.id, snap.data());
      const stopCount = (await stopsRef(record.id).count().get()).data().count;
      return { id: record.id, name: record.name, startDate: toDateOnly(record.startDate), durationDays: record.durationDays, stopCount, updatedAt: record.updatedAt };
    }),
  );
  return trips.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map((trip) => ({ ...trip, updatedAt: trip.updatedAt.toISOString() }));
}

export async function createTrip(ownerId: string, input: { name: string; notes?: string; startDate?: string | null; durationDays?: number | null; roundTrip?: boolean; origin: Endpoint; destination: Endpoint }) {
  const id = randomUUID();
  const now = new Date();
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
    overnight: stopType === "destination",
    hotels: [],
    dayTrips: [],
  }));
  const allStops = input.roundTrip ? renumber([...stops, makeReturnStop(stops[0])]) : stops;

  const batch = getDb().batch();
  batch.set(tripRef(id), {
    ownerId,
    name: input.name,
    notes: input.notes ?? "",
    startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
    durationDays: input.durationDays ?? null,
    preferences: DEFAULT_PREFERENCES,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  for (const stop of allStops) batch.set(stopsRef(id).doc(stop.id), toStopData(stop));
  batch.set(revisionsRef(id).doc(revisionId(1)), revisionData(1, "Trip created", { stops: allStops, preferences: DEFAULT_PREFERENCES }, now));
  await batch.commit();
  return id;
}

export async function getTripView(tripId: string, ownerId: string, services = getServices()): Promise<TripView> {
  const trip = await loadOwnedTrip(tripId, ownerId);
  const stopSnaps = await stopsRef(tripId).orderBy("sequence").get();
  const preferences = toPreferences(trip.preferences);
  const stops = sortStops(stopSnaps.docs.map((snap) => toStop(snap.id, snap.data())));
  const { legs, errors } = await computeLegs(stops, preferences, services);
  const dayTrips = await computeDayTrips(stops, preferences, services);
  const routeGeometry = legs.flatMap((leg) => leg.geometry);
  const legMetrics = legs.map(({ distanceMeters, durationSeconds, provider, status }) => ({ distanceMeters, durationSeconds, provider, status }));
  const itinerary = buildItinerary({ stops, legs: legMetrics, preferences, durationDays: trip.durationDays, startDate: toDateOnly(trip.startDate), dayTrips: dayTrips.legs });

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
    routeErrors: [...errors, ...dayTrips.errors],
    routeGeometry,
    dayTripRoutes: dayTrips.legs.filter((leg) => leg.geometry.length > 1).map((leg) => ({ id: leg.id, name: leg.name, geometry: leg.geometry })),
    itinerary,
    modes: services.modes,
    updatedAt: trip.updatedAt.toISOString(),
  };
}

/**
 * Applies typed operations atomically. The version is read and checked inside the same transaction
 * as the writes, so two tabs (or the AI and the user) cannot both apply the same base version.
 */
export async function applyTripChange(input: { tripId: string; ownerId: string; expectedVersion: number; operations: TripOperation[]; summary: string }) {
  await getDb().runTransaction(async (tx) => {
    const tripSnap = await tx.get(tripRef(input.tripId));
    if (!tripSnap.exists || tripSnap.data()!.ownerId !== input.ownerId) throw new AppError(404, "trip_not_found", "Trip not found.");
    if (tripSnap.data()!.version !== input.expectedVersion) {
      throw new AppError(409, "version_conflict", "This trip changed in another window. Reload to see the latest version, then try again.");
    }
    const stopSnaps = await tx.get(stopsRef(input.tripId));
    const latest = await tx.get(revisionsRef(input.tripId).orderBy("revisionNumber", "desc").limit(1));
    const current = stopSnaps.docs.map((snap) => toStop(snap.id, snap.data()));
    const before = { stops: sortStops(current), preferences: toPreferences(tripSnap.data()!.preferences) };
    const result = applyOperations(before, input.operations);
    const nextRevision = (latest.docs[0]?.data().revisionNumber ?? 0) + 1;

    const keptIds = new Set(result.stops.map((stop) => stop.id));
    for (const stop of current) {
      if (!keptIds.has(stop.id)) tx.delete(stopsRef(input.tripId).doc(stop.id));
    }
    for (const stop of result.stops) tx.set(stopsRef(input.tripId).doc(stop.id), toStopData(stop));

    const now = new Date();
    tx.update(tripRef(input.tripId), { preferences: result.preferences, version: input.expectedVersion + 1, updatedAt: now });
    tx.set(revisionsRef(input.tripId).doc(revisionId(nextRevision)), revisionData(nextRevision, input.summary, { stops: result.stops, preferences: result.preferences }, now));
  });
}

export async function updateTripDetails(input: { tripId: string; ownerId: string; expectedVersion: number; name?: string; notes?: string; startDate?: string | null; durationDays?: number | null }) {
  await getDb().runTransaction(async (tx) => {
    const tripSnap = await tx.get(tripRef(input.tripId));
    if (!tripSnap.exists || tripSnap.data()!.ownerId !== input.ownerId) throw new AppError(404, "trip_not_found", "Trip not found.");
    if (tripSnap.data()!.version !== input.expectedVersion) throw new AppError(409, "version_conflict", "This trip changed in another window. Reload to see the latest version.");
    tx.update(tripRef(input.tripId), {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null } : {}),
      ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
    });
  });
}

/** Restores the state from before the most recent change. The restore itself is recorded as a new revision. */
export async function undoLastChange(input: { tripId: string; ownerId: string; expectedVersion: number }) {
  await loadOwnedTrip(input.tripId, input.ownerId);
  const revisions = await revisionsRef(input.tripId).orderBy("revisionNumber", "desc").limit(2).get();
  const [latest, previous] = revisions.docs.map((snap) => snap.data());
  if (!latest || !previous || latest.revisionNumber === 1) throw new AppError(409, "nothing_to_undo", "There is no earlier change to undo.");
  const snapshot = JSON.parse(previous.snapshot) as { stops?: Stop[]; preferences?: TripPreferences };
  if (!snapshot.stops) throw new AppError(409, "nothing_to_undo", "There is no earlier change to undo.");
  const undone = snapshot.stops;
  await getDb().runTransaction(async (tx) => {
    const tripSnap = await tx.get(tripRef(input.tripId));
    if (!tripSnap.exists || tripSnap.data()!.version !== input.expectedVersion) {
      throw new AppError(409, "version_conflict", "This trip changed in another window. Reload and try again.");
    }
    const currentSnaps = await tx.get(stopsRef(input.tripId));
    const latestRevision = await tx.get(revisionsRef(input.tripId).orderBy("revisionNumber", "desc").limit(1));
    const nextRevision = (latestRevision.docs[0]?.data().revisionNumber ?? 0) + 1;
    const restoredIds = new Set(undone.map((stop) => stop.id));
    for (const snap of currentSnaps.docs) {
      if (!restoredIds.has(snap.id)) tx.delete(snap.ref);
    }
    for (const stop of undone) tx.set(stopsRef(input.tripId).doc(stop.id), toStopData(stop));

    const now = new Date();
    const tripUpdate: Record<string, unknown> = { version: input.expectedVersion + 1, updatedAt: now };
    if (snapshot.preferences) tripUpdate.preferences = snapshot.preferences;
    tx.update(tripRef(input.tripId), tripUpdate);
    tx.set(revisionsRef(input.tripId).doc(revisionId(nextRevision)), revisionData(nextRevision, `Undid: ${latest.summary}`, { stops: undone, preferences: snapshot.preferences }, now));
  });
}

export async function deleteTrip(tripId: string, ownerId: string) {
  await loadOwnedTrip(tripId, ownerId);
  await getDb().recursiveDelete(tripRef(tripId));
}

/** Deletes the chosen trips. Any ID that is not one of the owner's trips is refused, so nothing else is touched. */
export async function deleteTripsByIds(ownerId: string, tripIds: string[]) {
  const unique = [...new Set(tripIds)];
  const snaps = unique.length ? await getDb().getAll(...unique.map((id) => tripRef(id))) : [];
  const owned = snaps.filter((snap) => snap.exists && snap.data()!.ownerId === ownerId);
  if (owned.length !== unique.length) throw new AppError(404, "trip_not_found", "One or more selected trips could not be found. Refresh the list and try again.");
  await Promise.all(owned.map((snap) => getDb().recursiveDelete(snap.ref)));
  return owned.length;
}

/** Trips that started before today. Trips with no start date are not historical, so they are kept. */
async function historicalTripSnaps(ownerId: string, today: Date) {
  const snaps = await tripsRef().where("ownerId", "==", ownerId).get();
  return snaps.docs.filter((snap) => {
    const startDate = toDate(snap.data().startDate);
    return startDate !== null && startDate < today;
  });
}

export async function countHistoricalTrips(ownerId: string, today = startOfUtcDay(new Date())) {
  return (await historicalTripSnaps(ownerId, today)).length;
}

/**
 * Deletes the owner's historical trips. The caller passes the count the user confirmed, and the
 * delete is refused if the number has changed, so the user never removes trips they did not see.
 */
export async function deleteHistoricalTrips(ownerId: string, expectedCount: number, today = startOfUtcDay(new Date())) {
  const snaps = await historicalTripSnaps(ownerId, today);
  if (snaps.length !== expectedCount) {
    throw new AppError(409, "count_changed", `The number of past trips changed (now ${snaps.length}). Review the list and try again.`);
  }
  await Promise.all(snaps.map((snap) => getDb().recursiveDelete(snap.ref)));
  return snaps.length;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const HOTEL_SEARCH_RADIUS_METERS = Math.round(10 * 1609.344);

/** Hotels near an overnight stop, for choosing where to stay. Listings only: availability and prices are not checked. */
export async function findHotelsNearStop(input: { tripId: string; ownerId: string; stopId: string; services?: Services }) {
  const services = input.services ?? getServices();
  await loadOwnedTrip(input.tripId, input.ownerId);
  const snap = await stopsRef(input.tripId).doc(input.stopId).get();
  if (!snap.exists) throw new AppError(404, "stop_not_found", "That stop no longer exists. Refresh the trip and try again.");
  const stop = toStop(snap.id, snap.data()!);
  if (!stop.overnight) throw new AppError(422, "not_overnight", "Hotels can only be added to an overnight stop.");
  if (!services.places.searchHotels) throw new AppError(409, "hotel_search_unavailable", "Hotel search needs a Geoapify places key. Add GEOAPIFY_API_KEY to .env.local.");
  return services.places.searchHotels([stop.longitude, stop.latitude], HOTEL_SEARCH_RADIUS_METERS);
}

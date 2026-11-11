import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { haversineMeters, isValidLatitude, isValidLongitude, type LngLat } from "./geo";

export const STOP_TYPES = ["origin", "destination", "required", "optional", "return"] as const;
export type StopType = (typeof STOP_TYPES)[number];
export type StopSource = "user" | "upload" | "ai" | "poi";
export type Leg = "outbound" | "return";

export const MAX_INTERMEDIATE_STOPS = 40;
export const DEFAULT_MAX_DAILY_DRIVE_MINUTES = 360;

export type Stop = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  sequence: number;
  stopType: StopType;
  source: StopSource;
  notes: string;
  visitMinutes: number | null;
};

export type TripPreferences = {
  maxDailyDriveMinutes: number;
  routePreference: "fastest" | "shortest";
  avoid: ("tollways" | "highways" | "ferries")[];
};

export const DEFAULT_PREFERENCES: TripPreferences = {
  maxDailyDriveMinutes: DEFAULT_MAX_DAILY_DRIVE_MINUTES,
  routePreference: "fastest",
  avoid: [],
};

const coordinate = z.object({ latitude: z.number().refine(isValidLatitude, "Latitude must be between -90 and 90."), longitude: z.number().refine(isValidLongitude, "Longitude must be between -180 and 180.") });
const stopName = z.string().trim().min(1, "Stop name is required.").max(120);
const notes = z.string().max(1000).default("");
const visitMinutes = z.number().int().min(0).max(24 * 60).nullable().default(null);

/** Every change to a trip goes through these typed operations. The AI assistant can only propose these. */
export const tripOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_stop"),
    name: stopName,
    address: z.string().max(300).default(""),
    ...coordinate.shape,
    stopType: z.enum(["required", "optional"]).default("required"),
    /** "outbound" goes before the destination; "return" goes after it, on the way back. Return turns on round trip. */
    leg: z.enum(["outbound", "return"]).default("outbound"),
    source: z.enum(["user", "upload", "ai", "poi"]).default("user"),
    notes,
    visitMinutes,
    placeId: z.string().optional(),
    /** Index among the stops on the chosen leg. Omitted means append to that leg. */
    index: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal("remove_stop"), stopId: z.string(), confirmRequired: z.boolean().default(false) }),
  /** Moves a stop to a position on a leg. Omitting `leg` keeps the stop on the leg it is already on. */
  z.object({ type: z.literal("move_stop"), stopId: z.string(), toIndex: z.number().int().min(0), leg: z.enum(["outbound", "return"]).optional() }),
  z.object({
    type: z.literal("update_stop"),
    stopId: z.string(),
    name: stopName.optional(),
    notes: z.string().max(1000).optional(),
    visitMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
    stopType: z.enum(["required", "optional"]).optional(),
  }),
  z.object({ type: z.literal("optimize_order") }),
  z.object({
    type: z.literal("set_preferences"),
    maxDailyDriveMinutes: z.number().int().min(60).max(900).optional(),
    routePreference: z.enum(["fastest", "shortest"]).optional(),
    avoid: z.array(z.enum(["tollways", "highways", "ferries"])).optional(),
  }),
  /** Turns the return to the origin on or off. The return is a real stop at the end of the route. */
  z.object({ type: z.literal("set_round_trip"), enabled: z.boolean() }),
]);

/** Input shape: optional fields such as `leg` take their defaults when applied. */
export type TripOperation = z.input<typeof tripOperationSchema>;

export type ApplyResult = { stops: Stop[]; preferences: TripPreferences; createdStopIds: Record<number, string> };

/** Stops are kept as origin, outbound stops, destination, return-leg stops, then the optional return to origin. */
export function sortStops(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}

/** Origin, destination and return cannot be removed or reordered; they are the fixed parts of the route. */
export function isFixedStop(stop: Stop): boolean {
  return stop.stopType === "origin" || stop.stopType === "destination" || stop.stopType === "return";
}

export function intermediateStops(stops: Stop[]): Stop[] {
  return sortStops(stops).filter((stop) => !isFixedStop(stop));
}

export function isRoundTrip(stops: Stop[]): boolean {
  return stops.some((stop) => stop.stopType === "return");
}

export function renumber(stops: Stop[]): Stop[] {
  return stops.map((stop, sequence) => ({ ...stop, sequence }));
}

function requireStop(stops: Stop[], stopId: string): Stop {
  const stop = stops.find((item) => item.id === stopId);
  if (!stop) throw new AppError(404, "stop_not_found", "That stop no longer exists. Refresh the trip and try again.");
  return stop;
}

/** The return stop repeats the origin's location, so the route ends where it started. */
export function makeReturnStop(origin: Stop): Stop {
  return { id: randomUUID(), name: origin.name, address: origin.address, latitude: origin.latitude, longitude: origin.longitude, sequence: 0, stopType: "return", source: "user", notes: "", visitMinutes: 0 };
}

type Legs = { origin?: Stop; destination?: Stop; outbound: Stop[]; inbound: Stop[]; returns: Stop[] };

/** Splits the route into the outbound leg (origin to destination) and the return leg (destination back to origin). */
function splitLegs(stops: Stop[]): Legs {
  const sorted = sortStops(stops);
  const destinationIndex = sorted.findIndex((stop) => stop.stopType === "destination");
  const origin = sorted.find((stop) => stop.stopType === "origin");
  const destination = destinationIndex >= 0 ? sorted[destinationIndex] : undefined;
  const before = destinationIndex >= 0 ? sorted.slice(0, destinationIndex) : sorted;
  const after = destinationIndex >= 0 ? sorted.slice(destinationIndex + 1) : [];
  return {
    origin,
    destination,
    outbound: before.filter((stop) => !isFixedStop(stop)),
    inbound: after.filter((stop) => !isFixedStop(stop)),
    returns: after.filter((stop) => stop.stopType === "return"),
  };
}

function assemble(legs: Legs): Stop[] {
  return renumber([legs.origin!, ...legs.outbound, legs.destination!, ...legs.inbound, ...legs.returns]);
}

/** Greedy nearest-neighbour ordering of one leg, starting from a point. A fast heuristic, not an optimal solver. */
function nearestNeighbour(start: Stop, stops: Stop[]): Stop[] {
  const remaining = [...stops];
  const ordered: Stop[] = [];
  let current: LngLat = [start.longitude, start.latitude];
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      const distance = haversineMeters(current, [stop.longitude, stop.latitude]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = [next.longitude, next.latitude];
  }
  return ordered;
}

/** Pure function: applies operations to a copy of the stops and returns the new state. Throws AppError on invalid input. */
export function applyOperations(input: { stops: Stop[]; preferences: TripPreferences }, operations: TripOperation[]): ApplyResult {
  let stops = renumber(sortStops(input.stops));
  let preferences = { ...input.preferences };
  const createdStopIds: Record<number, string> = {};

  operations.forEach((operation, operationIndex) => {
    switch (operation.type) {
      case "add_stop": {
        const legs = splitLegs(stops);
        if (intermediateStops(stops).length >= MAX_INTERMEDIATE_STOPS) {
          throw new AppError(422, "too_many_stops", `A trip can have at most ${MAX_INTERMEDIATE_STOPS} intermediate stops.`);
        }
        if (!legs.origin || !legs.destination) throw new AppError(422, "missing_endpoints", "Set an origin and destination before adding stops.");
        const id = randomUUID();
        const stop: Stop = {
          id,
          name: operation.name,
          address: operation.address ?? "",
          latitude: operation.latitude,
          longitude: operation.longitude,
          sequence: 0,
          stopType: operation.stopType ?? "required",
          source: operation.source ?? "user",
          notes: operation.notes ?? "",
          visitMinutes: operation.visitMinutes ?? null,
        };
        if (operation.leg === "return") {
          // A return-leg stop only makes sense on a round trip, so adding one turns round trip on.
          if (legs.returns.length === 0) legs.returns = [makeReturnStop(legs.origin)];
          const index = Math.min(operation.index ?? legs.inbound.length, legs.inbound.length);
          legs.inbound = [...legs.inbound.slice(0, index), stop, ...legs.inbound.slice(index)];
        } else {
          const index = Math.min(operation.index ?? legs.outbound.length, legs.outbound.length);
          legs.outbound = [...legs.outbound.slice(0, index), stop, ...legs.outbound.slice(index)];
        }
        stops = assemble(legs);
        createdStopIds[operationIndex] = id;
        break;
      }
      case "remove_stop": {
        const stop = requireStop(stops, operation.stopId);
        if (isFixedStop(stop)) {
          throw new AppError(422, "endpoint_required", "The origin, destination and return cannot be removed. Turn off round trip to remove the return.");
        }
        if (stop.stopType === "required" && !operation.confirmRequired) {
          throw new AppError(409, "confirmation_required", `"${stop.name}" is a required stop. Confirm before removing it.`, { stopId: stop.id });
        }
        stops = renumber(stops.filter((item) => item.id !== stop.id));
        break;
      }
      case "move_stop": {
        const stop = requireStop(stops, operation.stopId);
        if (isFixedStop(stop)) {
          throw new AppError(422, "endpoint_required", "The origin, destination and return cannot be reordered.");
        }
        const legs = splitLegs(stops);
        const onReturnLeg = legs.inbound.some((item) => item.id === stop.id);
        const targetReturn = operation.leg ? operation.leg === "return" : onReturnLeg;
        if (targetReturn && !legs.origin) throw new AppError(422, "missing_endpoints", "Set an origin before moving stops to the return trip.");
        if (targetReturn && legs.returns.length === 0) legs.returns = [makeReturnStop(legs.origin!)];
        // Take the stop off its current leg, then insert it at the requested position on the target leg.
        legs.outbound = legs.outbound.filter((item) => item.id !== stop.id);
        legs.inbound = legs.inbound.filter((item) => item.id !== stop.id);
        const target = targetReturn ? legs.inbound : legs.outbound;
        const index = Math.min(operation.toIndex, target.length);
        const updated = [...target.slice(0, index), stop, ...target.slice(index)];
        if (targetReturn) legs.inbound = updated;
        else legs.outbound = updated;
        stops = assemble(legs);
        break;
      }
      case "update_stop": {
        const stop = requireStop(stops, operation.stopId);
        const fixed = isFixedStop(stop);
        if (operation.stopType && fixed) throw new AppError(422, "endpoint_type", "Origin, destination and return cannot change type.");
        stops = stops.map((item) =>
          item.id === stop.id
            ? {
                ...item,
                name: operation.name ?? item.name,
                notes: operation.notes ?? item.notes,
                visitMinutes: operation.visitMinutes === undefined ? item.visitMinutes : operation.visitMinutes,
                stopType: fixed ? item.stopType : (operation.stopType ?? item.stopType),
              }
            : item,
        );
        break;
      }
      case "optimize_order": {
        stops = renumber(optimisedRoute(stops));
        break;
      }
      case "set_preferences": {
        preferences = {
          ...preferences,
          maxDailyDriveMinutes: operation.maxDailyDriveMinutes ?? preferences.maxDailyDriveMinutes,
          routePreference: operation.routePreference ?? preferences.routePreference,
          avoid: operation.avoid ?? preferences.avoid,
        };
        break;
      }
      case "set_round_trip": {
        const legs = splitLegs(stops);
        if (!legs.origin) throw new AppError(422, "missing_endpoints", "Set an origin before changing the trip type.");
        if (operation.enabled && legs.returns.length === 0) {
          legs.returns = [makeReturnStop(legs.origin)];
          stops = assemble(legs);
        } else if (!operation.enabled && legs.returns.length > 0) {
          stops = renumber(stops.filter((stop) => stop.stopType !== "return"));
        }
        break;
      }
    }
  });

  return { stops, preferences, createdStopIds };
}

/** Orders each leg separately: outbound from the origin, return-leg from the destination. Endpoints and leg membership are kept. */
export function optimisedRoute(stops: Stop[]): Stop[] {
  const legs = splitLegs(stops);
  if (!legs.origin || !legs.destination) return sortStops(stops);
  return assemble({
    ...legs,
    outbound: nearestNeighbour(legs.origin, legs.outbound),
    inbound: nearestNeighbour(legs.destination, legs.inbound),
  });
}

/** Kept for callers that only need the outbound order. Use optimisedRoute for the full route. */
export function nearestNeighborOrder(stops: Stop[]): Stop[] {
  return optimisedRoute(stops);
}

export function tripEndpoints(stops: Stop[]) {
  const sorted = sortStops(stops);
  return { origin: sorted.find((stop) => stop.stopType === "origin") ?? null, destination: sorted.find((stop) => stop.stopType === "destination") ?? null };
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { haversineMeters, isValidLatitude, isValidLongitude, type LngLat } from "./geo";

export const STOP_TYPES = ["origin", "destination", "required", "optional"] as const;
export type StopType = (typeof STOP_TYPES)[number];
export type StopSource = "user" | "upload" | "ai" | "poi";

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
    source: z.enum(["user", "upload", "ai", "poi"]).default("user"),
    notes,
    visitMinutes,
    placeId: z.string().optional(),
    /** Index among intermediate stops. Omitted means append before the destination. */
    index: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal("remove_stop"), stopId: z.string(), confirmRequired: z.boolean().default(false) }),
  z.object({ type: z.literal("move_stop"), stopId: z.string(), toIndex: z.number().int().min(0) }),
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
]);

export type TripOperation = z.infer<typeof tripOperationSchema>;

export type ApplyResult = { stops: Stop[]; preferences: TripPreferences; createdStopIds: Record<number, string> };

/** Stops are kept as origin, intermediate stops in order, destination. */
export function sortStops(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}

export function intermediateStops(stops: Stop[]): Stop[] {
  return sortStops(stops).filter((stop) => stop.stopType !== "origin" && stop.stopType !== "destination");
}

export function renumber(stops: Stop[]): Stop[] {
  return stops.map((stop, sequence) => ({ ...stop, sequence }));
}

function requireStop(stops: Stop[], stopId: string): Stop {
  const stop = stops.find((item) => item.id === stopId);
  if (!stop) throw new AppError(404, "stop_not_found", "That stop no longer exists. Refresh the trip and try again.");
  return stop;
}

/** Pure function: applies operations to a copy of the stops and returns the new state. Throws AppError on invalid input. */
export function applyOperations(input: { stops: Stop[]; preferences: TripPreferences }, operations: TripOperation[]): ApplyResult {
  let stops = renumber(sortStops(input.stops));
  let preferences = { ...input.preferences };
  const createdStopIds: Record<number, string> = {};

  operations.forEach((operation, operationIndex) => {
    switch (operation.type) {
      case "add_stop": {
        const intermediates = intermediateStops(stops);
        if (intermediates.length >= MAX_INTERMEDIATE_STOPS) {
          throw new AppError(422, "too_many_stops", `A trip can have at most ${MAX_INTERMEDIATE_STOPS} intermediate stops.`);
        }
        const origin = stops.find((stop) => stop.stopType === "origin");
        const destination = stops.find((stop) => stop.stopType === "destination");
        if (!origin || !destination) throw new AppError(422, "missing_endpoints", "Set an origin and destination before adding stops.");
        const id = randomUUID();
        const stop: Stop = {
          id,
          name: operation.name,
          address: operation.address,
          latitude: operation.latitude,
          longitude: operation.longitude,
          sequence: 0,
          stopType: operation.stopType,
          source: operation.source,
          notes: operation.notes,
          visitMinutes: operation.visitMinutes,
        };
        const index = Math.min(operation.index ?? intermediates.length, intermediates.length);
        const reordered = [origin, ...intermediates.slice(0, index), stop, ...intermediates.slice(index), destination];
        stops = renumber(reordered);
        createdStopIds[operationIndex] = id;
        break;
      }
      case "remove_stop": {
        const stop = requireStop(stops, operation.stopId);
        if (stop.stopType === "origin" || stop.stopType === "destination") {
          throw new AppError(422, "endpoint_required", "The origin and destination can be changed but not removed.");
        }
        if (stop.stopType === "required" && !operation.confirmRequired) {
          throw new AppError(409, "confirmation_required", `"${stop.name}" is a required stop. Confirm before removing it.`, { stopId: stop.id });
        }
        stops = renumber(stops.filter((item) => item.id !== stop.id));
        break;
      }
      case "move_stop": {
        const stop = requireStop(stops, operation.stopId);
        if (stop.stopType === "origin" || stop.stopType === "destination") {
          throw new AppError(422, "endpoint_required", "The origin and destination cannot be reordered.");
        }
        const intermediates = intermediateStops(stops).filter((item) => item.id !== stop.id);
        const index = Math.min(operation.toIndex, intermediates.length);
        const origin = stops.find((item) => item.stopType === "origin")!;
        const destination = stops.find((item) => item.stopType === "destination")!;
        stops = renumber([origin, ...intermediates.slice(0, index), stop, ...intermediates.slice(index), destination]);
        break;
      }
      case "update_stop": {
        const stop = requireStop(stops, operation.stopId);
        const isEndpoint = stop.stopType === "origin" || stop.stopType === "destination";
        if (operation.stopType && isEndpoint) throw new AppError(422, "endpoint_type", "Origin and destination cannot change type.");
        stops = stops.map((item) =>
          item.id === stop.id
            ? {
                ...item,
                name: operation.name ?? item.name,
                notes: operation.notes ?? item.notes,
                visitMinutes: operation.visitMinutes === undefined ? item.visitMinutes : operation.visitMinutes,
                stopType: isEndpoint ? item.stopType : (operation.stopType ?? item.stopType),
              }
            : item,
        );
        break;
      }
      case "optimize_order": {
        stops = renumber(nearestNeighborOrder(stops));
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
    }
  });

  return { stops, preferences, createdStopIds };
}

/** Greedy nearest-neighbour ordering of intermediate stops, starting from the origin. A fast heuristic, not an optimal TSP solution. */
export function nearestNeighborOrder(stops: Stop[]): Stop[] {
  const origin = stops.find((stop) => stop.stopType === "origin")!;
  const destination = stops.find((stop) => stop.stopType === "destination")!;
  const remaining = intermediateStops(stops);
  const ordered: Stop[] = [];
  let current: LngLat = [origin.longitude, origin.latitude];
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
  return [origin, ...ordered, destination];
}

export function tripEndpoints(stops: Stop[]) {
  const sorted = sortStops(stops);
  return { origin: sorted.find((stop) => stop.stopType === "origin") ?? null, destination: sorted.find((stop) => stop.stopType === "destination") ?? null };
}

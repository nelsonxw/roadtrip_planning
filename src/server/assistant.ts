import { buildItinerary, type LegMetrics } from "@/domain/itinerary";
import { applyOperations, intermediateStops, type Stop, type TripOperation, type TripPreferences } from "@/domain/trip";
import { AppError } from "@/lib/errors";
import { getServices, type Services } from "@/services/providers";
import { computeLegs, type TripView } from "./tripService";

export type AssistantPlan = {
  reply: string;
  summary: string;
  operations: TripOperation[];
};

export type ProposalImpact = {
  baseVersion: number;
  requiresConfirmation: boolean;
  before: { distanceMeters: number; driveDurationSeconds: number; drivingDays: number };
  after: { distanceMeters: number; driveDurationSeconds: number; drivingDays: number };
  deltaDriveSeconds: number;
  deltaDistanceMeters: number;
  notes: string[];
  routeErrors: string[];
};

const HELP =
  "I can add or remove stops, reorder them, or lower your daily driving limit. Try \"add Santa Fe\", \"remove Lunch stop\", or \"reduce daily driving\". Changes are only applied after you accept them.";

const findStop = (stops: Stop[], text: string) => {
  const needle = text.trim().toLowerCase();
  return intermediateStops(stops).find((stop) => {
    const name = stop.name.toLowerCase();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
};

/**
 * Rule-based planner used when no language model is configured. It only maps messages to
 * typed operations, which the server validates and which the user must accept.
 */
export async function planFromMessage(view: Pick<TripView, "stops" | "preferences">, message: string, services: Services = getServices()): Promise<AssistantPlan> {
  const text = message.trim();
  const lower = text.toLowerCase();
  const demoNote = services.modes.assistant === "demo" ? " (Demo assistant: rule-based, no language model connected.)" : "";

  const removeMatch = lower.match(/^(?:please\s+)?(?:remove|delete|drop)\s+(?:the\s+)?(.+)$/);
  if (removeMatch) {
    const stop = findStop(view.stops, removeMatch[1]);
    if (!stop) return { reply: `I couldn't find a stop matching "${removeMatch[1]}" in your itinerary.${demoNote}`, summary: "", operations: [] };
    const required = stop.stopType === "required";
    return {
      reply: `I propose removing "${stop.name}".${required ? " It is a required stop, so you will be asked to confirm before it is removed." : ""}${demoNote}`,
      summary: `Remove ${stop.name}`,
      operations: [{ type: "remove_stop", stopId: stop.id, confirmRequired: false }],
    };
  }

  const addMatch = text.match(/^(?:please\s+)?(?:add|include)\s+(?:a\s+|an\s+|the\s+)?(.+)$/i);
  if (addMatch) {
    const query = addMatch[1].trim();
    const [candidate] = await services.geocoding.search(query, 1);
    if (!candidate) return { reply: `I couldn't find a location called "${query}". Try a more specific name, such as "Santa Fe, NM".${demoNote}`, summary: "", operations: [] };
    return {
      reply: `I suggest adding "${candidate.label}" as an optional stop. Accept to apply it to the route and itinerary.${demoNote}`,
      summary: `Add ${candidate.name}`,
      operations: [{ type: "add_stop", name: candidate.name, address: candidate.label, latitude: candidate.latitude, longitude: candidate.longitude, stopType: "optional", source: "ai", notes: "", visitMinutes: null }],
    };
  }

  if (/(less|reduce|lower|shorter|cut).*(driv|drive)|(driv|drive).*(less|shorter|lower)/.test(lower)) {
    const current = view.preferences.maxDailyDriveMinutes;
    const next = Math.max(120, current - 60);
    if (next === current) return { reply: `Your daily driving limit is already at the minimum I can suggest (2 hours).${demoNote}`, summary: "", operations: [] };
    return {
      reply: `I propose lowering your daily driving limit from ${Math.round(current / 60)} h to ${Math.round(next / 60)} h. The itinerary will add days where needed, and the impact below uses real route times.${demoNote}`,
      summary: "Lower daily driving limit",
      operations: [{ type: "set_preferences", maxDailyDriveMinutes: next }],
    };
  }

  if (/optimi[sz]e|reorder|best order/.test(lower)) {
    return { reply: `I propose reordering the intermediate stops by nearest neighbour to shorten the route. Your origin and destination stay fixed.${demoNote}`, summary: "Optimize stop order", operations: [{ type: "optimize_order" }] };
  }

  return { reply: HELP + demoNote, summary: "", operations: [] };
}

function totalsOf(stops: Stop[], legs: LegMetrics[], preferences: TripPreferences) {
  const { totals } = buildItinerary({ stops, legs, preferences, durationDays: null, startDate: null });
  return { distanceMeters: totals.distanceMeters, driveDurationSeconds: totals.driveDurationSeconds, drivingDays: totals.drivingDays };
}

/** Simulates operations on a copy of the trip and measures real route impact. Nothing is written. */
export async function simulateImpact(view: Pick<TripView, "stops" | "preferences" | "version">, operations: TripOperation[], services: Services = getServices()): Promise<ProposalImpact> {
  const current = await computeLegs(view.stops, view.preferences, services);
  const before = totalsOf(view.stops, current.legs, view.preferences);
  // Preview previews the removal; confirmation is enforced when the proposal is accepted.
  const previewOps = operations.map((op) => (op.type === "remove_stop" ? { ...op, confirmRequired: true } : op));
  const next = applyOperations({ stops: view.stops, preferences: view.preferences }, previewOps);
  const after = await computeLegs(next.stops, next.preferences, services);
  const afterTotals = totalsOf(next.stops, after.legs, next.preferences);
  const requiresConfirmation = operations.some(
    (op) => op.type === "remove_stop" && view.stops.find((stop) => stop.id === op.stopId)?.stopType === "required",
  );
  return {
    baseVersion: view.version,
    requiresConfirmation,
    before,
    after: afterTotals,
    deltaDriveSeconds: afterTotals.driveDurationSeconds - before.driveDurationSeconds,
    deltaDistanceMeters: afterTotals.distanceMeters - before.distanceMeters,
    notes: ["Driving times come from the routing provider and exclude breaks, traffic and time at stops."],
    routeErrors: after.errors,
  };
}

export function assertProposalNotStale(baseVersion: number, currentVersion: number) {
  if (baseVersion !== currentVersion) {
    throw new AppError(409, "proposal_stale", "The trip changed after this suggestion was made. Ask the assistant again to get an up-to-date proposal.");
  }
}

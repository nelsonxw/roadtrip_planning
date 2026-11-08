import { tripOperationSchema, type TripOperation } from "@/domain/trip";
import { ProviderError } from "@/lib/errors";
import { formatDistance, formatDuration } from "@/lib/format";
import { createGeminiGenerator, type FunctionDeclaration, type GenerateFn, type GeminiContent } from "@/services/assistant/gemini";
import { getServices, type Services } from "@/services/providers";
import type { GeocodeCandidate } from "@/services/types";
import { planFromMessage, type AssistantPlan } from "./assistant";
import type { TripView } from "./tripService";

const MAX_TOOL_STEPS = 4;
const MAX_ACTIONS = 5;
const HISTORY_TURNS = 6;
const COORDINATE_TOLERANCE = 1e-6;

export type ChatTurn = { role: string; content: string };

const FIND_LOCATION: FunctionDeclaration = {
  name: "find_location",
  description: "Search for a real place by name. Returns candidates with coordinates. Call this before proposing any new stop.",
  parameters: {
    type: "OBJECT",
    properties: { query: { type: "STRING", description: "Place name with region, for example 'Santa Fe, NM'" } },
    required: ["query"],
  },
};

const PROPOSE_CHANGE: FunctionDeclaration = {
  name: "propose_change",
  description: "Propose changes to the trip. The user must accept before anything changes. Never say a change has been made.",
  parameters: {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING", description: "Short label for the proposal" },
      actions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["add_stop", "remove_stop", "move_stop", "optimize_order", "set_max_daily_drive_minutes"] },
            stop_id: { type: "STRING", description: "Existing stop id from the trip summary" },
            name: { type: "STRING" },
            latitude: { type: "NUMBER", description: "Must come from a find_location result" },
            longitude: { type: "NUMBER", description: "Must come from a find_location result" },
            required: { type: "BOOLEAN", description: "true only if the user said the stop must be kept" },
            to_index: { type: "INTEGER", description: "Position among intermediate stops, starting at 0" },
            minutes: { type: "INTEGER", description: "Daily driving limit in minutes, 60 to 900" },
          },
          required: ["type"],
        },
      },
    },
    required: ["summary", "actions"],
  },
};

type ProposedAction = {
  type: string;
  stop_id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  required?: boolean;
  to_index?: number;
  minutes?: number;
};

export function buildSystemPrompt(view: TripView): string {
  const { totals } = view.itinerary;
  const stopLines = view.stops.map((stop) => `- id=${stop.id} [${stop.stopType}] ${stop.name} (visit ${stop.visitMinutes ?? "unknown"} min)`);
  return [
    "You are the planning assistant for RoadTrip AI. You help one user change one road trip.",
    "Rules:",
    "1. Never invent distances, drive times, opening hours, place details, photos or coordinates. Use only numbers from the trip summary and from find_location results.",
    "2. To change the trip, call propose_change. Nothing changes until the user accepts. Never say a change was made or applied.",
    "3. Call find_location before proposing any new stop. Only add places it returned.",
    "4. Ask one short question only when essential information is missing.",
    "5. Keep replies under 80 words.",
    "6. Driving times are estimates from the route source given below. They exclude breaks, traffic and time at stops.",
    "",
    "Trip summary:",
    `Name: ${view.name}`,
    `Start date: ${view.startDate ?? "not set"}; planned days: ${view.durationDays ?? "not set"}`,
    `Daily driving limit: ${Math.round(view.preferences.maxDailyDriveMinutes)} minutes`,
    `Route: ${totals.drivingDays} driving day(s), ${formatDistance(totals.distanceMeters)}, ${formatDuration(totals.driveDurationSeconds)} driving`,
    view.modes.routing === "demo"
      ? "Route source: DEMO straight-line estimate, not live road data. Say so whenever you quote these numbers."
      : "Route source: routing provider estimate (excludes breaks, traffic and time at stops).",
    ...(view.itinerary.warnings.length ? [`Warnings: ${view.itinerary.warnings.join(" ")}`] : []),
    "Stops in order:",
    ...stopLines,
  ].join("\n");
}

function resultText(candidates: GeocodeCandidate[]) {
  return candidates.map((c) => ({ label: c.label, name: c.name, latitude: c.latitude, longitude: c.longitude }));
}

function findCandidate(candidates: GeocodeCandidate[], latitude: number, longitude: number) {
  return candidates.find((c) => Math.abs(c.latitude - latitude) < COORDINATE_TOLERANCE && Math.abs(c.longitude - longitude) < COORDINATE_TOLERANCE);
}

/** Converts model-proposed actions into validated trip operations. Anything that does not check out is dropped and reported. */
export function toOperations(actions: ProposedAction[], view: TripView, candidates: GeocodeCandidate[]) {
  const operations: TripOperation[] = [];
  const dropped: string[] = [];
  const stopIds = new Set(view.stops.filter((s) => s.stopType === "required" || s.stopType === "optional").map((s) => s.id));

  for (const action of actions.slice(0, MAX_ACTIONS)) {
    let candidate: unknown;
    switch (action.type) {
      case "add_stop": {
        const match = typeof action.latitude === "number" && typeof action.longitude === "number" ? findCandidate(candidates, action.latitude, action.longitude) : undefined;
        if (!match) {
          dropped.push(`"${action.name ?? "a stop"}" was not found by a location search`);
          continue;
        }
        candidate = { type: "add_stop", name: match.name || action.name || match.label, address: match.label, latitude: match.latitude, longitude: match.longitude, stopType: action.required ? "required" : "optional", source: "ai", notes: "", visitMinutes: null };
        break;
      }
      case "remove_stop":
        candidate = stopIds.has(action.stop_id ?? "") ? { type: "remove_stop", stopId: action.stop_id, confirmRequired: false } : null;
        break;
      case "move_stop":
        candidate = stopIds.has(action.stop_id ?? "") && Number.isInteger(action.to_index) ? { type: "move_stop", stopId: action.stop_id, toIndex: action.to_index } : null;
        break;
      case "optimize_order":
        candidate = { type: "optimize_order" };
        break;
      case "set_max_daily_drive_minutes":
        candidate = Number.isInteger(action.minutes) ? { type: "set_preferences", maxDailyDriveMinutes: action.minutes } : null;
        break;
      default:
        candidate = null;
    }
    const parsed = candidate ? tripOperationSchema.safeParse(candidate) : null;
    if (parsed?.success) operations.push(parsed.data);
    else dropped.push(`an unsupported "${action.type}" change was ignored`);
  }
  return { operations, dropped };
}

/**
 * Runs a Gemini tool-calling turn. The model can search for places and propose changes.
 * It cannot write to the trip; proposals are validated here and only applied after the user accepts.
 */
export async function planWithModel(input: { view: TripView; message: string; history: ChatTurn[]; services: Services; generate: GenerateFn }): Promise<AssistantPlan> {
  const { view, message, history, services, generate } = input;
  const contents: GeminiContent[] = [
    ...history
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .slice(-HISTORY_TURNS)
      .map((turn) => ({ role: turn.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: turn.content }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  const candidates: GeocodeCandidate[] = [];
  let proposal: { summary: string; actions: ProposedAction[] } | null = null;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const reply = await generate({ systemInstruction: buildSystemPrompt(view), contents, tools: [FIND_LOCATION, PROPOSE_CHANGE] });
    contents.push(reply);
    const calls = reply.parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
    if (calls.length === 0) {
      const text = reply.parts.map((part) => part.text ?? "").join("").trim();
      return finish(text || "Here is what I can do.", view, proposal, candidates);
    }

    const responses = [];
    for (const call of calls) {
      if (call.name === "find_location") {
        const results = await services.geocoding.search(String(call.args?.query ?? "").slice(0, 120), 5);
        candidates.push(...results);
        responses.push({ functionResponse: { name: call.name, response: { results: resultText(results) } } });
      } else if (call.name === "propose_change") {
        const args = call.args ?? {};
        proposal = { summary: String(args.summary ?? "Proposed change").slice(0, 300), actions: Array.isArray(args.actions) ? (args.actions as ProposedAction[]) : [] };
        responses.push({ functionResponse: { name: call.name, response: { status: "shown_to_user", note: "Nothing has changed yet. The user must accept." } } });
      } else {
        responses.push({ functionResponse: { name: call.name, response: { error: "Unknown tool." } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }
  return { reply: "I could not finish that request. Try rephrasing it with a place name or a specific change.", summary: "", operations: [] };
}

const DRIVING_NUMBERS = /\d+\s*(h\b|hour|min|mile|km)/i;
const DEMO_ROUTE_NOTE = " (Demo route estimate, not live road data.)";

function finish(text: string, view: TripView, proposal: { summary: string; actions: ProposedAction[] } | null, candidates: GeocodeCandidate[]): AssistantPlan {
  // Demo routing numbers must never look live, even if the model forgets to say so.
  const labelled = view.modes.routing === "demo" && DRIVING_NUMBERS.test(text) && !text.includes("Demo route") ? `${text}${DEMO_ROUTE_NOTE}` : text;
  if (!proposal) return { reply: labelled, summary: "", operations: [] };
  const { operations, dropped } = toOperations(proposal.actions, view, candidates);
  const notes = dropped.length ? ` I left out: ${dropped.join("; ")}.` : "";
  return {
    reply: `${labelled}${operations.length ? "" : " I did not find any change I could apply."}${notes}`,
    summary: operations.length ? proposal.summary : "",
    operations,
  };
}

/** Plans one chat turn. Uses Gemini when configured; otherwise, or when the provider is unavailable, uses the rule-based helper. */
export async function planTripChange(view: TripView, message: string, history: ChatTurn[], services: Services = getServices()): Promise<AssistantPlan> {
  if (!services.assistantConfig) return planFromMessage(view, message, services);
  const { apiKey, model } = services.assistantConfig;
  try {
    return await planWithModel({ view, message, history, services, generate: createGeminiGenerator(apiKey, model) });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const fallback = await planFromMessage(view, message, services);
    return { ...fallback, reply: `The AI assistant is unavailable right now (${error.message}). Using the rule-based helper instead. ${fallback.reply}` };
  }
}

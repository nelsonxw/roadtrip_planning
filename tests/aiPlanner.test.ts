import { afterEach, describe, expect, it, vi } from "vitest";
import { planTripChange, planWithModel, toOperations } from "@/server/aiPlanner";
import type { TripView } from "@/server/tripService";
import { createGeminiGenerator, type GeminiContent, type GenerateFn } from "@/services/assistant/gemini";
import type { Services } from "@/services/providers";
import { DemoRouting, DemoPlaces, DemoImages } from "@/services/demo/demoServices";

const santaFe = { label: "Santa Fe, NM, USA", name: "Santa Fe", latitude: 35.687, longitude: -105.9378, confidence: 0.9 };

const view = {
  id: "t1",
  name: "Test",
  modes: { geocoding: "demo", routing: "demo", places: "live", assistant: "live" },
  startDate: null,
  durationDays: 3,
  preferences: { maxDailyDriveMinutes: 360, routePreference: "fastest", avoid: [] },
  stops: [
    { id: "o", name: "Austin", address: "", latitude: 30.27, longitude: -97.74, sequence: 0, stopType: "origin", source: "user", notes: "", visitMinutes: null },
    { id: "lunch", name: "Lunch stop", address: "", latitude: 30.5, longitude: -98, sequence: 1, stopType: "required", source: "user", notes: "", visitMinutes: 60 },
    { id: "d", name: "Denver", address: "", latitude: 39.74, longitude: -104.99, sequence: 2, stopType: "destination", source: "user", notes: "", visitMinutes: null },
  ],
  itinerary: { provisional: true, days: [], warnings: [], totals: { distanceMeters: 1000000, driveDurationSeconds: 36000, visitMinutes: 60, drivingDays: 1 } },
} as unknown as TripView;

function services(search: (q: string) => Promise<unknown[]>): Services {
  return {
    geocoding: { provider: "test", mode: "live", search: search as never },
    routing: new DemoRouting(),
    places: new DemoPlaces(),
    images: new DemoImages(),
    assistantConfig: { apiKey: "test-key", model: "gemini-3.8-flash" },
    modes: { geocoding: "live", routing: "demo", places: "live", assistant: "live" },
  } as Services;
}

/** Plays back a fixed sequence of model replies, one per call. */
function scripted(replies: GeminiContent[]): GenerateFn {
  let index = 0;
  return async () => {
    const reply = replies[index++];
    if (!reply) throw new Error("model called more times than scripted");
    return reply;
  };
}

const call = (name: string, args: Record<string, unknown>): GeminiContent => ({ role: "model", parts: [{ functionCall: { name, args } }] });
const text = (value: string): GeminiContent => ({ role: "model", parts: [{ text: value }] });

describe("toOperations", () => {
  it("accepts an add only when its coordinates match a location the search returned", () => {
    const { operations, dropped } = toOperations(
      [{ type: "add_stop", name: "Santa Fe", latitude: 35.687, longitude: -105.9378, required: false }],
      view,
      [santaFe],
    );
    expect(dropped).toEqual([]);
    expect(operations).toEqual([expect.objectContaining({ type: "add_stop", name: "Santa Fe", address: "Santa Fe, NM, USA", stopType: "optional", source: "ai" })]);
  });

  it("drops an add whose coordinates were not returned by a search", () => {
    const { operations, dropped } = toOperations([{ type: "add_stop", name: "Made up", latitude: 1, longitude: 2 }], view, [santaFe]);
    expect(operations).toEqual([]);
    expect(dropped[0]).toMatch(/not found by a location search/);
  });

  it("drops changes that reference unknown stops or fall outside the allowed limits", () => {
    const { operations, dropped } = toOperations(
      [
        { type: "remove_stop", stop_id: "nope" },
        { type: "set_max_daily_drive_minutes", minutes: 5 },
        { type: "move_stop", stop_id: "lunch", to_index: 0 },
      ],
      view,
      [],
    );
    expect(operations).toEqual([{ type: "move_stop", stopId: "lunch", toIndex: 0 }]);
    expect(dropped).toHaveLength(2);
  });

  it("never sets confirmation on a removal, so the user still has to confirm a required stop", () => {
    const { operations } = toOperations([{ type: "remove_stop", stop_id: "lunch" }], view, []);
    expect(operations).toEqual([{ type: "remove_stop", stopId: "lunch", confirmRequired: false }]);
  });

  it("caps the number of actions per proposal", () => {
    const actions = Array.from({ length: 9 }, () => ({ type: "optimize_order" }));
    expect(toOperations(actions, view, []).operations).toHaveLength(5);
  });
});

describe("planWithModel", () => {
  it("searches first, then proposes a validated change, then answers in text", async () => {
    const search = vi.fn(async () => [santaFe]);
    const plan = await planWithModel({
      view,
      message: "add Santa Fe",
      history: [],
      services: services(search),
      generate: scripted([
        call("find_location", { query: "Santa Fe, NM" }),
        call("propose_change", {
          summary: "Add Santa Fe",
          actions: [{ type: "add_stop", name: "Santa Fe", latitude: 35.687, longitude: -105.9378, required: false }],
        }),
        text("I suggest adding Santa Fe as an optional stop. Accept to apply it."),
      ]),
    });
    expect(search).toHaveBeenCalledWith("Santa Fe, NM", 5);
    expect(plan.operations).toHaveLength(1);
    expect(plan.summary).toBe("Add Santa Fe");
    expect(plan.reply).toMatch(/Accept to apply/);
  });

  it("returns a plain answer and no proposal when the model only talks", async () => {
    const plan = await planWithModel({ view, message: "hi", history: [], services: services(async () => []), generate: scripted([text("Hello! What would you like to change?")]) });
    expect(plan).toEqual({ reply: "Hello! What would you like to change?", summary: "", operations: [] });
  });

  it("labels driving numbers as demo estimates when the route source is demo", async () => {
    const plan = await planWithModel({
      view,
      message: "how long is the drive?",
      history: [],
      services: services(async () => []),
      generate: scripted([text("The drive is about 15 hours (918 miles).")]),
    });
    expect(plan.reply).toMatch(/Demo route estimate, not live road data/);
  });

  it("tells the user when a proposed stop could not be verified", async () => {
    const plan = await planWithModel({
      view,
      message: "add a secret place",
      history: [],
      services: services(async () => []),
      generate: scripted([
        call("propose_change", { summary: "Add secret", actions: [{ type: "add_stop", name: "Secret", latitude: 9, longitude: 9 }] }),
        text("Here is an idea."),
      ]),
    });
    expect(plan.operations).toEqual([]);
    expect(plan.reply).toMatch(/not found by a location search/);
  });

  it("stops after the maximum number of tool steps instead of looping forever", async () => {
    const plan = await planWithModel({
      view,
      message: "loop",
      history: [],
      services: services(async () => []),
      generate: async () => call("find_location", { query: "x" }),
    });
    expect(plan.operations).toEqual([]);
    expect(plan.reply).toMatch(/could not finish/);
  });
});

describe("Gemini client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a brief 503 and returns the model's answer", async () => {
    const answer = { candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await createGeminiGenerator("k", "gemini-3.5-flash")({ systemInstruction: "s", contents: [], tools: [] });
    expect(reply.parts[0].text).toBe("Hi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry rate limits", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createGeminiGenerator("k", "m")({ systemInstruction: "s", contents: [], tools: [] })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("planTripChange", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the rule-based helper when no assistant key is configured", async () => {
    const plan = await planTripChange(view, "reduce daily driving", [], { ...services(async () => []), assistantConfig: null, modes: { geocoding: "live", routing: "demo", places: "live", assistant: "demo" } } as Services);
    expect(plan.operations).toEqual([{ type: "set_preferences", maxDailyDriveMinutes: 300 }]);
  });

  it("falls back to the rule-based helper with a clear notice when the provider is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    const plan = await planTripChange(view, "reduce daily driving", [], services(async () => []));
    expect(plan.reply).toMatch(/unavailable right now/);
    expect(plan.operations).toEqual([{ type: "set_preferences", maxDailyDriveMinutes: 300 }]);
  });
});

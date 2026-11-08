import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Modules = {
  db: typeof import("@/lib/db").db;
  tripService: typeof import("@/server/tripService");
  proposals: typeof import("@/server/proposals");
  demo: typeof import("@/services/demo/demoServices");
  auth: typeof import("@/server/auth");
  AppError: typeof import("@/lib/errors").AppError;
  ProviderError: typeof import("@/lib/errors").ProviderError;
};

let m: Modules;
const ownerIds: string[] = [];
const origin = { name: "Austin, TX, USA", latitude: 30.2672, longitude: -97.7431 };
const destination = { name: "Denver, CO, USA", latitude: 39.7392, longitude: -104.9903 };

async function newUser(label: string) {
  const user = await m.db.user.create({ data: { email: `${label}-${randomUUID()}@test.local`, passwordHash: "x" } });
  ownerIds.push(user.id);
  return user.id;
}

async function newTrip(ownerId: string, extra: { durationDays?: number } = {}) {
  const id = await m.tripService.createTrip(ownerId, { name: "Test trip", origin, destination, durationDays: extra.durationDays ?? null });
  return id;
}

const demoServices = () => ({
  geocoding: new m.demo.DemoGeocoding(),
  routing: new m.demo.DemoRouting(),
  places: new m.demo.DemoPlaces(),
  images: new m.demo.DemoImages(),
  assistantConfig: null,
  modes: { geocoding: "demo" as const, routing: "demo" as const, places: "demo" as const, assistant: "demo" as const },
});

const addStop = (name: string, latitude: number, longitude: number, index?: number, stopType: "required" | "optional" = "required") => ({
  type: "add_stop" as const,
  name,
  address: "",
  latitude,
  longitude,
  stopType,
  source: "user" as const,
  notes: "",
  visitMinutes: null,
  index,
});

beforeAll(async () => {
  m = {
    db: (await import("@/lib/db")).db,
    tripService: await import("@/server/tripService"),
    proposals: await import("@/server/proposals"),
    demo: await import("@/services/demo/demoServices"),
    auth: await import("@/server/auth"),
    AppError: (await import("@/lib/errors")).AppError,
    ProviderError: (await import("@/lib/errors")).ProviderError,
  };
  // Pin the app's services to demo providers so tests never call live APIs, even when keys are in .env.local.
  (globalThis as unknown as { services: unknown }).services = demoServices();
});

afterAll(async () => {
  if (m) await m.db.user.deleteMany({ where: { id: { in: ownerIds } } });
  await m?.db.$disconnect();
});

describe("trip creation and ownership", () => {
  it("creates a trip with origin and destination and calculates the route with demo routing labelled as demo", async () => {
    const owner = await newUser("create");
    const id = await newTrip(owner);
    const view = await m.tripService.getTripView(id, owner, demoServices());
    expect(view.stops.map((s) => s.stopType)).toEqual(["origin", "destination"]);
    expect(view.legs).toHaveLength(1);
    expect(view.legs[0]).toMatchObject({ status: "ok", provider: "Demo straight-line estimate" });
    expect(view.version).toBe(1);
  });

  it("does not expose one user's trip to another user", async () => {
    const owner = await newUser("owner");
    const intruder = await newUser("intruder");
    const id = await newTrip(owner);
    await expect(m.tripService.getTripView(id, intruder, demoServices())).rejects.toMatchObject({ status: 404 });
    await expect(m.tripService.applyTripChange({ tripId: id, ownerId: intruder, expectedVersion: 1, operations: [addStop("x", 1, 1)], summary: "x" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(m.tripService.deleteTrip(id, intruder)).rejects.toMatchObject({ status: 404 });
    expect(await m.tripService.listTripsForOwner(intruder)).toEqual([]);
  });

  it("hashes passwords and stores session tokens only as hashes", async () => {
    const user = await m.db.user.create({ data: { email: `session-${randomUUID()}@test.local`, passwordHash: await m.auth.hashPassword("correct horse") } });
    ownerIds.push(user.id);
    expect(await m.auth.verifyPassword("correct horse", user.passwordHash)).toBe(true);
    expect(await m.auth.verifyPassword("wrong", user.passwordHash)).toBe(false);
    const { token } = await m.auth.createSession(user.id);
    const stored = await m.db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.id).not.toBe(token);
    expect(stored.id).toHaveLength(64);
  });
});

describe("stop editing, versioning and undo", () => {
  it("keeps manually added stops in the requested order", async () => {
    const owner = await newUser("order");
    const id = await newTrip(owner);
    await m.tripService.applyTripChange({
      tripId: id,
      ownerId: owner,
      expectedVersion: 1,
      summary: "Add three stops",
      operations: [addStop("First", 31, -98), addStop("Second", 32, -100), addStop("Third", 33, -102)],
    });
    const view = await m.tripService.getTripView(id, owner, demoServices());
    expect(view.stops.map((s) => s.name)).toEqual(["Austin, TX, USA", "First", "Second", "Third", "Denver, CO, USA"]);
    expect(view.version).toBe(2);
    expect(view.legs).toHaveLength(4);
  });

  it("rejects a write based on a stale version instead of silently overwriting", async () => {
    const owner = await newUser("stale");
    const id = await newTrip(owner);
    await m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 1, summary: "first", operations: [addStop("A", 31, -98)] });
    await expect(
      m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 1, summary: "second", operations: [addStop("B", 32, -99)] }),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });
  });

  it("requires confirmation before removing a required stop, and undo restores it", async () => {
    const owner = await newUser("required");
    const id = await newTrip(owner);
    await m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 1, summary: "add", operations: [addStop("Must see", 31, -98)] });
    const before = await m.tripService.getTripView(id, owner, demoServices());
    const mustSee = before.stops.find((s) => s.name === "Must see")!;
    await expect(
      m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 2, summary: "remove", operations: [{ type: "remove_stop", stopId: mustSee.id, confirmRequired: false }] }),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 2, summary: "remove", operations: [{ type: "remove_stop", stopId: mustSee.id, confirmRequired: true }] });
    expect((await m.tripService.getTripView(id, owner, demoServices())).stops).toHaveLength(2);
    await m.tripService.undoLastChange({ tripId: id, ownerId: owner, expectedVersion: 3 });
    const restored = await m.tripService.getTripView(id, owner, demoServices());
    expect(restored.stops.map((s) => s.id)).toContain(mustSee.id);
  });

  it("keeps user edits and reports the failing leg when the routing provider fails", async () => {
    const owner = await newUser("failure");
    const id = await newTrip(owner);
    await m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 1, summary: "add", operations: [addStop("Stop A", 31.1, -98.2)] });
    const failing = {
      ...demoServices(),
      routing: {
        provider: "Broken",
        mode: "live" as const,
        route: async () => {
          throw new m.ProviderError("OpenRouteService", "unavailable", "OpenRouteService responded with HTTP 503.");
        },
      },
    };
    const view = await m.tripService.getTripView(id, owner, failing);
    expect(view.stops.map((s) => s.name)).toContain("Stop A");
    expect(view.routeErrors.length).toBeGreaterThan(0);
    expect(view.legs.every((leg) => leg.status === "missing")).toBe(true);
    expect(view.itinerary.warnings.join(" ")).toMatch(/not calculated yet/);
  });
});

describe("stop-list import", () => {
  it("imports valid rows in file order and leaves invalid and ambiguous rows out of the trip", async () => {
    const importer = await import("@/server/stopImport");
    const owner = await newUser("import");
    const id = await newTrip(owner);
    const table = {
      headers: ["Name", "Address"],
      rows: [
        ["Denver Museum", "Denver"],
        ["Mystery", ""],
        ["Santa Fe", "Santa Fe"],
        ["Springfield", "Springfield"],
      ],
    };
    const mapping = { name: 0, address: 1 };
    const geocoder = new m.demo.DemoGeocoding();
    const rows = await importer.validateRows(table, mapping, {
      search: async (query) => (query === "Springfield" ? [{ label: "A", name: "A", latitude: 1, longitude: 1, confidence: 0.6 }, { label: "B", name: "B", latitude: 2, longitude: 2, confidence: 0.6 }] : geocoder.search(query, 5)),
    });
    expect(rows.map((r) => r.status)).toEqual(["ok", "invalid", "ok", "ambiguous"]);

    const importable = rows.flatMap((row) => (row.status === "ok" ? [row] : []));
    await m.tripService.applyTripChange({
      tripId: id,
      ownerId: owner,
      expectedVersion: 1,
      summary: "Imported",
      operations: importable.map((row) => ({
        type: "add_stop" as const,
        name: row.draft.name,
        address: row.draft.address,
        latitude: row.draft.latitude ?? row.resolved!.latitude,
        longitude: row.draft.longitude ?? row.resolved!.longitude,
        stopType: row.draft.stopType,
        source: "upload" as const,
        notes: row.draft.notes,
        visitMinutes: null,
      })),
    });
    const view = await m.tripService.getTripView(id, owner, demoServices());
    expect(view.stops.map((s) => s.name)).toEqual(["Austin, TX, USA", "Denver Museum", "Santa Fe", "Denver, CO, USA"]);
    expect(view.stops.filter((s) => s.source === "upload")).toHaveLength(2);
  });
});

describe("assistant proposals", () => {
  it("turns a chat request into a proposal that changes nothing until accepted", async () => {
    const owner = await newUser("chat");
    const id = await newTrip(owner);
    await m.proposals.handleChatMessage({ tripId: id, ownerId: owner, message: "add Santa Fe" });
    const before = await m.tripService.getTripView(id, owner, demoServices());
    expect(before.stops).toHaveLength(2);
    const messages = await m.proposals.listChat(id, owner);
    const proposal = messages.find((message) => message.proposal)?.proposal;
    expect(proposal?.status).toBe("pending");
    expect(proposal?.impact.baseVersion).toBe(1);
  });

  it("applies an accepted proposal once, and refuses a stale or repeated acceptance", async () => {
    const owner = await newUser("accept");
    const id = await newTrip(owner);
    await m.proposals.handleChatMessage({ tripId: id, ownerId: owner, message: "add Santa Fe" });
    const proposal = (await m.proposals.listChat(id, owner)).find((message) => message.proposal)!.proposal!;
    await m.tripService.applyTripChange({ tripId: id, ownerId: owner, expectedVersion: 1, summary: "manual edit", operations: [addStop("Manual", 31, -98)] });
    await expect(m.proposals.acceptProposal({ tripId: id, ownerId: owner, proposalId: proposal.id, confirmRequired: false })).rejects.toMatchObject({ code: "proposal_stale" });
    await m.proposals.rejectProposal({ tripId: id, ownerId: owner, proposalId: proposal.id });
    await expect(m.proposals.acceptProposal({ tripId: id, ownerId: owner, proposalId: proposal.id, confirmRequired: false })).rejects.toMatchObject({ code: "proposal_closed" });
  });

  it("accepts a proposal once when the base version still matches", async () => {
    const owner = await newUser("accept-once");
    const id = await newTrip(owner);
    await m.proposals.handleChatMessage({ tripId: id, ownerId: owner, message: "add Santa Fe" });
    const proposal = (await m.proposals.listChat(id, owner)).find((message) => message.proposal)!.proposal!;
    const trip = await m.proposals.acceptProposal({ tripId: id, ownerId: owner, proposalId: proposal.id, confirmRequired: false });
    expect(trip.stops.map((s) => s.name)).toContain("Santa Fe, NM, USA");
    await expect(m.proposals.acceptProposal({ tripId: id, ownerId: owner, proposalId: proposal.id, confirmRequired: false })).rejects.toMatchObject({ code: "proposal_closed" });
  });
});

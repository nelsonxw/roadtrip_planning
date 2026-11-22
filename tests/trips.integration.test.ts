import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTestUsers } from "./cleanup";

type Modules = {
  users: typeof import("@/server/users");
  getDb: typeof import("@/lib/firestore").getDb;
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
  const user = await m.users.createUser(`${label}-${randomUUID()}@test.local`, "x");
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
  places: new m.demo.NoPlacesService(),
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
    users: await import("@/server/users"),
    getDb: (await import("@/lib/firestore")).getDb,
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
  await removeTestUsers(ownerIds);
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
    const user = await m.users.createUser(`session-${randomUUID()}@test.local`, await m.auth.hashPassword("correct horse"));
    ownerIds.push(user.id);
    expect(await m.auth.verifyPassword("correct horse", user.passwordHash)).toBe(true);
    expect(await m.auth.verifyPassword("wrong", user.passwordHash)).toBe(false);
    const { token } = await m.auth.createSession(user.id);
    const hashedId = createHash("sha256").update(token).digest("hex");
    const stored = await m.getDb().collection("sessions").doc(hashedId).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()!.userId).toBe(user.id);
    expect(hashedId).not.toBe(token);
    expect(hashedId).toHaveLength(64);
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
    expect((await m.tripService.listTripsForOwner(owner))[0].stopCount).toBe(5);
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

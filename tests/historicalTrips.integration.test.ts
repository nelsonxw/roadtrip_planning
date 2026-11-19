import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { removeTestUsers } from "./cleanup";

const ownerIds: string[] = [];
const origin = { name: "Austin, TX, USA", latitude: 30.2672, longitude: -97.7431 };
const destination = { name: "Denver, CO, USA", latitude: 39.7392, longitude: -104.9903 };

async function makeUser() {
  const { createUser } = await import("@/server/users");
  const user = await createUser(`hist-${randomUUID()}@test.local`, "x");
  ownerIds.push(user.id);
  return user.id;
}

async function makeTrip(ownerId: string, startDate: string | null) {
  const { createTrip } = await import("@/server/tripService");
  return createTrip(ownerId, { name: "t", origin, destination, startDate });
}

async function tripCount(ownerId: string) {
  const { getDb } = await import("@/lib/firestore");
  return (await getDb().collection("trips").where("ownerId", "==", ownerId).get()).size;
}

afterAll(async () => {
  await removeTestUsers(ownerIds);
});

describe("bulk delete of selected trips", () => {
  it("deletes selected trips owned by the user and refuses IDs owned by someone else", async () => {
    const { deleteTripsByIds } = await import("@/server/tripService");
    const { getDb } = await import("@/lib/firestore");
    const owner = await makeUser();
    const other = await makeUser();
    const mine = await makeTrip(owner, null);
    const mine2 = await makeTrip(owner, null);
    const theirs = await makeTrip(other, null);
    await expect(deleteTripsByIds(owner, [mine, theirs])).rejects.toMatchObject({ status: 404 });
    expect((await getDb().getAll(getDb().collection("trips").doc(mine), getDb().collection("trips").doc(theirs))).every((snap) => snap.exists)).toBe(true);
    expect(await deleteTripsByIds(owner, [mine, mine2])).toBe(2);
    expect((await getDb().collection("trips").doc(theirs).get()).exists).toBe(true);
  });
});

describe("historical trips", () => {
  const today = new Date("2026-11-10T00:00:00Z");

  it("counts only trips that started before today, keeping future and undated trips", async () => {
    const { countHistoricalTrips } = await import("@/server/tripService");
    const owner = await makeUser();
    await makeTrip(owner, "2026-10-01");
    await makeTrip(owner, "2026-11-10");
    await makeTrip(owner, "2027-01-01");
    await makeTrip(owner, null);
    expect(await countHistoricalTrips(owner, today)).toBe(1);
  });

  it("deletes only the owner's past trips", async () => {
    const { deleteHistoricalTrips, countHistoricalTrips } = await import("@/server/tripService");
    const owner = await makeUser();
    const other = await makeUser();
    await makeTrip(owner, "2026-01-01");
    await makeTrip(owner, "2026-02-01");
    await makeTrip(owner, "2030-01-01");
    await makeTrip(other, "2026-01-01");
    expect(await deleteHistoricalTrips(owner, 2, today)).toBe(2);
    expect(await countHistoricalTrips(owner, today)).toBe(0);
    expect(await tripCount(owner)).toBe(1);
    expect(await tripCount(other)).toBe(1);
  });

  it("refuses to delete when the count changed since the user confirmed", async () => {
    const { deleteHistoricalTrips } = await import("@/server/tripService");
    const owner = await makeUser();
    await makeTrip(owner, "2026-01-01");
    await makeTrip(owner, "2026-02-01");
    await expect(deleteHistoricalTrips(owner, 1, today)).rejects.toMatchObject({ status: 409, code: "count_changed" });
    expect(await tripCount(owner)).toBe(2);
  });
});

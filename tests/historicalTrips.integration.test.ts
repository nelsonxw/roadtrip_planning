import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

const ownerIds: string[] = [];

async function makeUser() {
  const { db } = await import("@/lib/db");
  const user = await db.user.create({ data: { email: `hist-${randomUUID()}@test.local`, passwordHash: "x" } });
  ownerIds.push(user.id);
  return user.id;
}

async function makeTrip(ownerId: string, startDate: string | null) {
  const { db } = await import("@/lib/db");
  return db.trip.create({ data: { ownerId, name: "t", startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : null } });
}

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.user.deleteMany({ where: { id: { in: ownerIds } } });
  await db.$disconnect();
});

describe("bulk delete of selected trips", () => {
  it("deletes selected trips owned by the user and refuses IDs owned by someone else", async () => {
    const { deleteTripsByIds } = await import("@/server/tripService");
    const { db } = await import("@/lib/db");
    const owner = await makeUser();
    const other = await makeUser();
    const mine = await makeTrip(owner, null);
    const mine2 = await makeTrip(owner, null);
    const theirs = await makeTrip(other, null);
    await expect(deleteTripsByIds(owner, [mine.id, theirs.id])).rejects.toMatchObject({ status: 404 });
    expect(await db.trip.count({ where: { id: { in: [mine.id, theirs.id] } } })).toBe(2);
    expect(await deleteTripsByIds(owner, [mine.id, mine2.id])).toBe(2);
    expect(await db.trip.count({ where: { id: theirs.id } })).toBe(1);
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
    const { db } = await import("@/lib/db");
    expect(await db.trip.count({ where: { ownerId: owner } })).toBe(1);
    expect(await db.trip.count({ where: { ownerId: other } })).toBe(1);
  });

  it("refuses to delete when the count changed since the user confirmed", async () => {
    const { deleteHistoricalTrips } = await import("@/server/tripService");
    const owner = await makeUser();
    await makeTrip(owner, "2026-01-01");
    await makeTrip(owner, "2026-02-01");
    await expect(deleteHistoricalTrips(owner, 1, today)).rejects.toMatchObject({ status: 409, code: "count_changed" });
    const { db } = await import("@/lib/db");
    expect(await db.trip.count({ where: { ownerId: owner } })).toBe(2);
  });
});

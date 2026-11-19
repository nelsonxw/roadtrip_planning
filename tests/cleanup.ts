import { getDb } from "@/lib/firestore";

const CHUNK = 30;

/** Removes test accounts with everything they own: trips, sessions and the email index entry. */
export async function removeTestUsers(userIds: string[]) {
  const db = getDb();
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const trips = await db.collection("trips").where("ownerId", "in", chunk).get();
    for (const trip of trips.docs) await db.recursiveDelete(trip.ref);
    const sessions = await db.collection("sessions").where("userId", "in", chunk).get();
    const emailIndexes = await db.collection("userEmails").where("userId", "in", chunk).get();
    const batch = db.batch();
    for (const doc of [...sessions.docs, ...emailIndexes.docs]) batch.delete(doc.ref);
    for (const id of chunk) batch.delete(db.collection("users").doc(id));
    await batch.commit();
  }
}

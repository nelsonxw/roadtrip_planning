/**
 * One-time backfill: gives route-cache entries written before `expiresAt` existed an expiry,
 * so Firestore's TTL policy on `routeCache.expiresAt` also removes them.
 * Metadata only; no route data is deleted or changed.
 * Usage: npx tsx scripts/backfill-route-cache-expiry.ts [--apply]
 */
import { getDb } from "../src/lib/firestore";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 400;

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  const snapshot = await db.collection("routeCache").get();
  const missing = snapshot.docs.filter((doc) => !doc.data().expiresAt);
  console.log(`routeCache entries: ${snapshot.size}, missing expiresAt: ${missing.length}`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write expiresAt.");
    return;
  }
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of missing.slice(i, i + BATCH_SIZE)) {
      const createdAt = doc.data().createdAt?.toDate?.() ?? new Date();
      batch.update(doc.ref, { expiresAt: new Date(createdAt.getTime() + RETENTION_MS) });
    }
    await batch.commit();
  }
  console.log(`Backfilled ${missing.length} entries.`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

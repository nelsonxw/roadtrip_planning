import { z } from "zod";
import { MAX_INTERMEDIATE_STOPS, type TripOperation } from "@/domain/trip";
import { applyTripChange, getTripView } from "@/server/tripService";
import { authedRoute, json, parseBody } from "@/server/api";

const importedRow = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().max(300).default(""),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  stopType: z.enum(["required", "optional"]),
  notes: z.string().max(1000).default(""),
});

const commitSchema = z.object({
  expectedVersion: z.number().int(),
  rows: z.array(importedRow).min(1).max(MAX_INTERMEDIATE_STOPS),
});

/**
 * Applies the rows the user approved, in file order, as one atomic change.
 * The client has already reviewed the preview; the server still validates every value and checks the trip version.
 */
export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  const { expectedVersion, rows } = await parseBody(request, commitSchema);
  const operations: TripOperation[] = rows.map((row) => ({
    type: "add_stop",
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    stopType: row.stopType,
    source: "upload",
    notes: row.notes,
    visitMinutes: null,
  }));
  await applyTripChange({ tripId: id, ownerId: user.id, expectedVersion, operations, summary: `Imported ${rows.length} stop${rows.length === 1 ? "" : "s"} from a file` });
  return json(await getTripView(id, user.id));
});

import { AppError } from "@/lib/errors";
import { getServices } from "@/services/providers";
import { parseUpload, suggestMapping, validateRows, IMPORT_FIELDS, type ImportMapping } from "@/server/stopImport";
import { loadOwnedTrip } from "@/server/tripService";
import { authedRoute, json } from "@/server/api";

/**
 * Parses an uploaded stop list and validates every row without changing the trip.
 * The client sends the chosen column mapping back on each preview, so changing a mapping re-validates.
 */
export const POST = authedRoute<{ id: string }>(async (request, user, { id }) => {
  await loadOwnedTrip(id, user.id);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError(422, "missing_file", "Choose a CSV or XLSX file to upload.");

  const table = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name);
  const suggested = suggestMapping(table.headers);
  const requested = form?.get("mapping");
  const mapping: ImportMapping = typeof requested === "string" && requested ? parseMapping(requested, table.headers.length) : suggested;
  if (mapping.name === undefined) throw new AppError(422, "mapping_missing_name", "Map a column to the stop name.");

  const services = getServices();
  const rows = await validateRows(table, mapping, services.geocoding);
  return json({
    fileName: file.name,
    headers: table.headers,
    totalRows: table.rows.length,
    suggestedMapping: suggested,
    mapping,
    fields: IMPORT_FIELDS,
    geocodingMode: services.modes.geocoding,
    rows,
  });
});

function parseMapping(raw: string, columnCount: number): ImportMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(422, "invalid_mapping", "The column mapping could not be read.");
  }
  const mapping: ImportMapping = {};
  for (const field of IMPORT_FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= columnCount) {
      throw new AppError(422, "invalid_mapping", `The column chosen for ${field} does not exist in this file.`);
    }
    mapping[field] = value;
  }
  return mapping;
}

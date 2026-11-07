import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { isValidLatitude, isValidLongitude } from "@/domain/geo";
import { AppError } from "@/lib/errors";
import type { GeocodeCandidate } from "@/services/types";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
/** Rows without coordinates are geocoded one by one, so a single import caps how many lookups it triggers. */
export const MAX_GEOCODE_LOOKUPS = 100;
const AMBIGUITY_CONFIDENCE_GAP = 0.2;

export const IMPORT_FIELDS = ["name", "address", "latitude", "longitude", "stopType", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Maps each application field to a zero-based column index in the uploaded file. */
export type ImportMapping = Partial<Record<ImportField, number>>;

export type ParsedTable = { headers: string[]; rows: string[][] };

export type DraftStop = {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  stopType: "required" | "optional";
  notes: string;
};

export type RowResult =
  | { rowNumber: number; status: "ok"; draft: DraftStop; resolved: { label: string; latitude: number; longitude: number } | null }
  | { rowNumber: number; status: "ambiguous"; draft: DraftStop; candidates: GeocodeCandidate[] }
  | { rowNumber: number; status: "invalid"; reason: string; values: string[] };

const SYNONYMS: Record<ImportField, string[]> = {
  name: ["name", "stop", "stop name", "place", "location name", "title"],
  address: ["address", "city", "city/state", "city, state", "location", "place address", "town"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  stopType: ["required", "optional", "type", "stop type", "required/optional"],
  notes: ["notes", "note", "comment", "comments", "description"],
};

/** Reads CSV or XLSX into rows of text. Content is only parsed as data, never executed. */
export async function parseUpload(buffer: Buffer, filename: string): Promise<ParsedTable> {
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw new AppError(413, "file_too_large", "The file is larger than 2 MB. Split it into smaller files.");
  const extension = filename.toLowerCase().split(".").pop();
  let matrix: string[][];
  if (extension === "csv") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    matrix = parseCsv(text, { relax_column_count: true, skip_empty_lines: true, trim: true }) as string[][];
  } else if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError(422, "invalid_workbook", "This Excel file could not be read. Save it again as .xlsx or use CSV.");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError(422, "empty_workbook", "The workbook has no sheets.");
    matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      matrix.push(values.slice(1).map((value) => cellText(value)));
    });
  } else {
    throw new AppError(415, "unsupported_file", "Upload a .csv or .xlsx file.");
  }
  const [headerRow = [], ...dataRows] = matrix;
  const rows = dataRows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) throw new AppError(422, "no_rows", "The file has a header but no stop rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError(422, "too_many_rows", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  return { headers: headerRow.map((h) => String(h).trim()), rows };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "");
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Suggests which columns hold which fields, based on common header names. The user can override every choice. */
export function suggestMapping(headers: string[]): ImportMapping {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const mapping: ImportMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = normalized.findIndex((header) => SYNONYMS[field].includes(header));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

/** Anything not recognised as optional is treated as required, which is the safer default: required stops are never dropped silently. */
const OPTIONAL_WORDS = new Set(["optional", "no", "n", "false", "0", "maybe"]);

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Validates one row without any network call. Returns a reason for the user when a row cannot be used. */
export function validateRowShape(cells: string[], mapping: ImportMapping): { ok: true; draft: DraftStop } | { ok: false; reason: string } {
  const cell = (field: ImportField) => (mapping[field] === undefined ? "" : (cells[mapping[field]!] ?? "").trim());
  const name = cell("name");
  if (!name) return { ok: false, reason: "Stop name is missing." };
  if (name.length > 120) return { ok: false, reason: "Stop name is longer than 120 characters." };

  const lat = parseNumber(cell("latitude"));
  const lng = parseNumber(cell("longitude"));
  const hasLat = lat !== null;
  const hasLng = lng !== null;
  if (hasLat !== hasLng) return { ok: false, reason: "Provide both latitude and longitude, or neither." };
  if ((hasLat && Number.isNaN(lat)) || (hasLng && Number.isNaN(lng))) return { ok: false, reason: "Latitude or longitude is not a number." };
  if (hasLat && (!isValidLatitude(lat!) || !isValidLongitude(lng!))) return { ok: false, reason: "Coordinates are outside the valid range." };

  const address = cell("address");
  if (!hasLat && !address) return { ok: false, reason: "Provide an address or coordinates." };

  const typeText = cell("stopType").toLowerCase();
  const stopType = OPTIONAL_WORDS.has(typeText) ? "optional" : "required";
  return { ok: true, draft: { name, address, latitude: hasLat ? lat! : null, longitude: hasLng ? lng! : null, stopType, notes: cell("notes").slice(0, 1000) } };
}

/** Decides whether a geocoding result is usable without asking the user. */
export function classifyCandidates(candidates: GeocodeCandidate[]): { status: "resolved"; candidate: GeocodeCandidate } | { status: "ambiguous"; candidates: GeocodeCandidate[] } | { status: "not_found" } {
  if (candidates.length === 0) return { status: "not_found" };
  const [first, second] = candidates;
  if (!second) return { status: "resolved", candidate: first };
  const clearlyBest = first.confidence !== null && second.confidence !== null && first.confidence - second.confidence >= AMBIGUITY_CONFIDENCE_GAP;
  return clearlyBest ? { status: "resolved", candidate: first } : { status: "ambiguous", candidates: candidates.slice(0, 5) };
}

type Geocoder = { search(query: string, limit: number): Promise<GeocodeCandidate[]> };

/**
 * Full row pass used by the preview. Rows with coordinates need no lookup. Address-only rows are
 * geocoded up to MAX_GEOCODE_LOOKUPS; the rest are reported so the user can add coordinates.
 */
export async function validateRows(table: ParsedTable, mapping: ImportMapping, geocoder: Geocoder): Promise<RowResult[]> {
  let lookups = 0;
  const results: RowResult[] = [];
  for (const [index, cells] of table.rows.entries()) {
    const rowNumber = index + 2;
    const shape = validateRowShape(cells, mapping);
    if (!shape.ok) {
      results.push({ rowNumber, status: "invalid", reason: shape.reason, values: cells });
      continue;
    }
    const { draft } = shape;
    if (draft.latitude !== null && draft.longitude !== null) {
      results.push({ rowNumber, status: "ok", draft, resolved: null });
      continue;
    }
    if (lookups >= MAX_GEOCODE_LOOKUPS) {
      results.push({ rowNumber, status: "invalid", reason: "Too many address rows to look up in one import. Add coordinates or split the file.", values: cells });
      continue;
    }
    lookups++;
    const outcome = classifyCandidates(await geocoder.search(draft.address, 5));
    if (outcome.status === "not_found") {
      results.push({ rowNumber, status: "invalid", reason: `No location found for "${draft.address}".`, values: cells });
    } else if (outcome.status === "ambiguous") {
      results.push({ rowNumber, status: "ambiguous", draft, candidates: outcome.candidates });
    } else {
      const { candidate } = outcome;
      results.push({ rowNumber, status: "ok", draft, resolved: { label: candidate.label, latitude: candidate.latitude, longitude: candidate.longitude } });
    }
  }
  return results;
}

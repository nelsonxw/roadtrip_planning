import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { neutralizeFormulas } from "@/server/exporters";
import {
  classifyCandidates,
  MAX_GEOCODE_LOOKUPS,
  MAX_IMPORT_ROWS,
  parseUpload,
  suggestMapping,
  validateRows,
  validateRowShape,
} from "@/server/stopImport";
import type { GeocodeCandidate } from "@/services/types";

const candidate = (label: string, confidence: number | null = null): GeocodeCandidate => ({ label, name: label, latitude: 35, longitude: -105, confidence });

describe("suggestMapping", () => {
  it("matches common header names regardless of case and spacing", () => {
    const mapping = suggestMapping(["Stop Name", " City/State ", "LAT", "Lon", "Required", "Notes"]);
    expect(mapping).toEqual({ name: 0, address: 1, latitude: 2, longitude: 3, stopType: 4, notes: 5 });
  });

  it("leaves unknown headers unmapped", () => {
    expect(suggestMapping(["Foo", "Bar"])).toEqual({});
  });
});

describe("validateRowShape", () => {
  const mapping = { name: 0, address: 1, latitude: 2, longitude: 3, stopType: 4, notes: 5 };

  it("accepts an address-only row and treats an unrecognised type as required", () => {
    const result = validateRowShape(["Santa Fe", "Santa Fe, NM", "", "", "", ""], mapping);
    expect(result).toMatchObject({ ok: true, draft: { name: "Santa Fe", address: "Santa Fe, NM", latitude: null, stopType: "required" } });
  });

  it("marks recognised optional values as optional", () => {
    const result = validateRowShape(["Museum", "", "35.1", "-106.6", "no", ""], mapping);
    expect(result).toMatchObject({ ok: true, draft: { stopType: "optional", latitude: 35.1, longitude: -106.6 } });
  });

  it("explains each kind of invalid row", () => {
    expect(validateRowShape(["", "Denver", "", "", "", ""], mapping)).toEqual({ ok: false, reason: "Stop name is missing." });
    expect(validateRowShape(["Stop", "", "", "", "", ""], mapping)).toEqual({ ok: false, reason: "Provide an address or coordinates." });
    expect(validateRowShape(["Stop", "", "35", "", "", ""], mapping)).toEqual({ ok: false, reason: "Provide both latitude and longitude, or neither." });
    expect(validateRowShape(["Stop", "", "95", "-106", "", ""], mapping)).toEqual({ ok: false, reason: "Coordinates are outside the valid range." });
    expect(validateRowShape(["Stop", "", "abc", "-106", "", ""], mapping)).toEqual({ ok: false, reason: "Latitude or longitude is not a number." });
  });
});

describe("classifyCandidates", () => {
  it("resolves a single result and reports no results as not found", () => {
    expect(classifyCandidates([])).toEqual({ status: "not_found" });
    expect(classifyCandidates([candidate("Only")]).status).toBe("resolved");
  });

  it("treats close alternatives as ambiguous and a clearly better match as resolved", () => {
    expect(classifyCandidates([candidate("Springfield, IL", 0.8), candidate("Springfield, MO", 0.75)]).status).toBe("ambiguous");
    expect(classifyCandidates([candidate("Springfield, IL", 0.95), candidate("Springfield, MO", 0.5)]).status).toBe("resolved");
    expect(classifyCandidates([candidate("A"), candidate("B")]).status).toBe("ambiguous");
  });
});

describe("parseUpload", () => {
  it("reads CSV with a byte-order mark, skipping blank lines", async () => {
    const csv = "\uFEFFName,Address\nSanta Fe,Santa Fe NM\n\n,\nMoab,Moab UT\n";
    const table = await parseUpload(Buffer.from(csv, "utf8"), "stops.csv");
    expect(table.headers).toEqual(["Name", "Address"]);
    expect(table.rows).toEqual([["Santa Fe", "Santa Fe NM"], ["Moab", "Moab UT"]]);
  });

  it("reads XLSX workbooks", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Stops");
    sheet.addRow(["Stop", "Lat", "Lng"]);
    sheet.addRow(["Museum", 35.1, -106.6]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const table = await parseUpload(buffer, "stops.xlsx");
    expect(table.headers).toEqual(["Stop", "Lat", "Lng"]);
    expect(table.rows[0]).toEqual(["Museum", "35.1", "-106.6"]);
  });

  it("rejects unsupported types, oversized files and too many rows", async () => {
    await expect(parseUpload(Buffer.from("x"), "stops.txt")).rejects.toMatchObject({ status: 415 });
    await expect(parseUpload(Buffer.alloc(3 * 1024 * 1024), "stops.csv")).rejects.toMatchObject({ status: 413 });
    const many = ["Name", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Stop ${i}`)].join("\n");
    await expect(parseUpload(Buffer.from(many), "stops.csv")).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a header-only file", async () => {
    await expect(parseUpload(Buffer.from("Name,Address\n"), "stops.csv")).rejects.toMatchObject({ status: 422 });
  });
});

describe("neutralizeFormulas", () => {
  it("prefixes spreadsheet-formula starters and leaves ordinary text alone", () => {
    expect(neutralizeFormulas({ name: "=HYPERLINK(\"x\")", notes: "-2 hours", plain: "Museum", n: 3 })).toEqual({ name: "'=HYPERLINK(\"x\")", notes: "'-2 hours", plain: "Museum", n: 3 });
  });
});

describe("validateRows", () => {
  const mapping = { name: 0, address: 1 };
  const geocoder = (results: Record<string, GeocodeCandidate[]>) => ({
    search: async (query: string) => results[query] ?? [],
  });

  it("keeps file order and reports each row's outcome with its row number", async () => {
    const table = { headers: ["Name", "Address"], rows: [["Santa Fe", "Santa Fe"], ["", "Nowhere"], ["Springfield", "Springfield"], ["Ghost", "Atlantis"]] };
    const results = await validateRows(
      table,
      mapping,
      geocoder({
        "Santa Fe": [candidate("Santa Fe, NM", 0.9)],
        Springfield: [candidate("Springfield, IL", 0.7), candidate("Springfield, MO", 0.68)],
      }),
    );
    expect(results.map((r) => [r.rowNumber, r.status])).toEqual([
      [2, "ok"],
      [3, "invalid"],
      [4, "ambiguous"],
      [5, "invalid"],
    ]);
    const ambiguous = results[2];
    expect(ambiguous.status === "ambiguous" && ambiguous.candidates).toHaveLength(2);
  });

  it("limits geocoding lookups per import and reports the rest", async () => {
    const rows = Array.from({ length: MAX_GEOCODE_LOOKUPS + 2 }, (_, i) => [`Stop ${i}`, `Place ${i}`]);
    const results = await validateRows({ headers: [], rows }, mapping, geocoder({}));
    const overflow = results.slice(MAX_GEOCODE_LOOKUPS);
    expect(overflow.every((r) => r.status === "invalid")).toBe(true);
  });
});

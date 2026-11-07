"use client";

import { useState } from "react";
import { api } from "@/lib/clientApi";
import type { ImportCommitRow } from "./useTrip";

type ImportField = "name" | "address" | "latitude" | "longitude" | "stopType" | "notes";
const FIELD_LABELS: Record<ImportField, string> = { name: "Stop name (required)", address: "Address or city", latitude: "Latitude", longitude: "Longitude", stopType: "Required or optional", notes: "Notes" };
const FIELDS = Object.keys(FIELD_LABELS) as ImportField[];

type Candidate = { label: string; name: string; latitude: number; longitude: number; confidence: number | null };
type Row =
  | { rowNumber: number; status: "ok"; draft: Omit<ImportCommitRow, "latitude" | "longitude"> & { latitude: number | null; longitude: number | null }; resolved: { label: string; latitude: number; longitude: number } | null }
  | { rowNumber: number; status: "ambiguous"; draft: Omit<ImportCommitRow, "latitude" | "longitude"> & { latitude: number | null; longitude: number | null }; candidates: Candidate[] }
  | { rowNumber: number; status: "invalid"; reason: string; values: string[] };

type Preview = {
  fileName: string;
  headers: string[];
  totalRows: number;
  mapping: Partial<Record<ImportField, number>>;
  geocodingMode: "live" | "demo";
  rows: Row[];
};

type Props = { tripId: string; onClose: () => void; commit: (rows: ImportCommitRow[]) => Promise<boolean> };

/** Upload → preview → map columns → review each row → import. Nothing is written until the final button. */
export function ImportStops({ tripId, onClose, commit }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Preview["mapping"]>({});
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview(nextFile: File, nextMapping?: Preview["mapping"]) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", nextFile);
      if (nextMapping) form.append("mapping", JSON.stringify(nextMapping));
      const data = await api<Preview>(`/api/trips/${tripId}/import/preview`, { method: "POST", body: form });
      setPreview(data);
      setMapping(data.mapping);
      setChosen({});
      setExcluded(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function toCommitRow(row: Row, choice: number | undefined): ImportCommitRow | null {
    if (row.status === "invalid") return null;
    if (row.status === "ok") {
      const coords = row.draft.latitude !== null && row.draft.longitude !== null ? { latitude: row.draft.latitude, longitude: row.draft.longitude } : row.resolved;
      if (!coords) return null;
      return { name: row.draft.name, address: row.draft.address, latitude: coords.latitude, longitude: coords.longitude, stopType: row.draft.stopType, notes: row.draft.notes };
    }
    const picked = choice === undefined ? undefined : row.candidates[choice];
    if (!picked) return null;
    return { name: row.draft.name, address: picked.label, latitude: picked.latitude, longitude: picked.longitude, stopType: row.draft.stopType, notes: row.draft.notes };
  }

  const commitRows = preview
    ? preview.rows.flatMap((row) => {
        if (excluded.has(row.rowNumber)) return [];
        const commitRow = toCommitRow(row, chosen[row.rowNumber]);
        return commitRow ? [{ rowNumber: row.rowNumber, commitRow }] : [];
      })
    : [];

  async function importNow() {
    setBusy(true);
    setError(null);
    const ok = await commit(commitRows.map((r) => r.commitRow));
    setBusy(false);
    if (ok) onClose();
    else setError("The import was not applied. Your file is still here. Check the message above, then try again.");
  }

  return (
    <section aria-labelledby="import-heading" className="space-y-3 rounded-lg border border-slate-300 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 id="import-heading" className="font-semibold text-slate-900">Import a stop list</h3>
        <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900" aria-label="Close import">✕</button>
      </div>
      <p className="text-xs text-slate-600">
        Upload CSV or XLSX (max 2 MB, 500 rows). Stops keep the order in your file. Rows without coordinates are looked up by address.{" "}
        <a className="text-sky-700 underline" href="/templates/stops-template.csv" download>Download template</a>
      </p>
      <label className="block">
        <span className="sr-only">Choose file</span>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(null); if (f) loadPreview(f); }} className="block w-full text-xs" />
      </label>
      {busy && <p role="status" className="text-xs text-slate-600">Working…</p>}
      {error && <p role="alert" className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</p>}

      {preview && (
        <>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1 text-xs font-medium text-slate-700">Match your columns</legend>
            {FIELDS.map((field) => (
              <label key={field} className="text-xs text-slate-700">
                {FIELD_LABELS[field]}
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => {
                    const next = { ...mapping, [field]: e.target.value === "" ? undefined : Number(e.target.value) };
                    setMapping(next);
                    if (file) loadPreview(file, next);
                  }}
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
                >
                  <option value="">Not used</option>
                  {preview.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>{header || `Column ${index + 1}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          {preview.geocodingMode === "demo" && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">DEMO geocoding: only a few sample places can be found. Add coordinates for other places.</p>}
          <p className="text-xs text-slate-700">{preview.totalRows} rows · {commitRows.length} will be imported · {preview.rows.filter((r) => r.status === "invalid").length} invalid · {preview.rows.filter((r) => r.status === "ambiguous").length} need a choice</p>

          <ol className="max-h-72 space-y-2 overflow-y-auto" aria-label="Rows to review">
            {preview.rows.map((row) => (
              <li key={row.rowNumber} className="rounded border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-slate-900">Row {row.rowNumber}: {row.status === "invalid" ? row.values[mapping.name ?? 0] || "(no name)" : row.draft.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${row.status === "ok" ? "bg-emerald-100 text-emerald-800" : row.status === "ambiguous" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800"}`}>
                    {row.status === "ok" ? "Ready" : row.status === "ambiguous" ? "Choose location" : "Skipped"}
                  </span>
                </div>
                {row.status === "invalid" && <p className="mt-1 text-xs text-rose-700">{row.reason}</p>}
                {row.status === "ok" && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={!excluded.has(row.rowNumber)} onChange={(e) => setExcluded((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(row.rowNumber); else next.add(row.rowNumber); return next; })} />
                    {row.resolved ? `Location: ${row.resolved.label}` : `Coordinates: ${row.draft.latitude}, ${row.draft.longitude}`} · {row.draft.stopType}
                  </label>
                )}
                {row.status === "ambiguous" && (
                  <fieldset className="mt-1 space-y-1">
                    <legend className="text-xs text-amber-900">Which “{row.draft.address}” did you mean?</legend>
                    {row.candidates.map((candidate, index) => (
                      <label key={`${candidate.latitude},${candidate.longitude}`} className="flex items-center gap-2 text-xs">
                        <input type="radio" name={`row-${row.rowNumber}`} checked={chosen[row.rowNumber] === index} onChange={() => setChosen((prev) => ({ ...prev, [row.rowNumber]: index }))} />
                        {candidate.label}
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            ))}
          </ol>

          <button type="button" disabled={busy || commitRows.length === 0} onClick={importNow} className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Import {commitRows.length} stop{commitRows.length === 1 ? "" : "s"}
          </button>
        </>
      )}
    </section>
  );
}

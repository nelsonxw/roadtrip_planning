"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/clientApi";

export type TripListItem = { id: string; name: string; stopCount: number; durationDays: number | null; startDate: string | null };

/** Trip list with checkboxes and a select-all box. Deleting always asks for confirmation first. */
export function TripList({ trips }: { trips: TripListItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const allSelected = trips.length > 0 && selected.size === trips.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(trips.map((trip) => trip.id)));
  }

  async function deleteSelected() {
    const ids = [...selected];
    const confirmed = window.confirm(`Delete ${ids.length} selected trip${ids.length === 1 ? "" : "s"}? This cannot be undone.`);
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const { deleted } = await api<{ deleted: number }>("/api/trips/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
      setSelected(new Set());
      setMessage(`Deleted ${deleted} trip${deleted === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete the selected trips.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Select all trips"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
            disabled={trips.length === 0 || busy}
          />
          Select all
        </label>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={selected.size === 0 || busy}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {busy ? "Deleting..." : `Delete selected (${selected.size})`}
        </button>
      </div>
      {message && <p role="status" className="mb-3 text-xs text-slate-600">{message}</p>}
      <ul className="space-y-3">
        {trips.map((trip) => (
          <li key={trip.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              aria-label={`Select ${trip.name}`}
              checked={selected.has(trip.id)}
              onChange={() => toggle(trip.id)}
              disabled={busy}
              className="mt-5"
            />
            <Link href={`/trips/${trip.id}`} className="block flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300">
              <span className="font-medium text-slate-900">{trip.name}</span>
              <span className="mt-1 block text-sm text-slate-600">
                {trip.stopCount} stops{trip.durationDays ? ` · ${trip.durationDays} days` : ""}{trip.startDate ? ` · starts ${trip.startDate}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

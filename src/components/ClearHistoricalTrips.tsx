"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/clientApi";

/** Asks for confirmation with the exact count before deleting. The server re-checks that count. */
export function ClearHistoricalTrips() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const { count } = await api<{ count: number }>("/api/trips/historical");
      if (count === 0) {
        setMessage("No past trips to clear. Trips without a start date are kept.");
        return;
      }
      const confirmed = window.confirm(`Delete ${count} past trip${count === 1 ? "" : "s"}? This cannot be undone.`);
      if (!confirmed) return;
      const { deleted } = await api<{ deleted: number }>("/api/trips/historical", { method: "DELETE", body: JSON.stringify({ expectedCount: count }) });
      setMessage(`Deleted ${deleted} past trip${deleted === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not clear past trips.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={clear} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {busy ? "Checking..." : "Clear past trips"}
      </button>
      {message && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
    </div>
  );
}

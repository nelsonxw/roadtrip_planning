"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";

type Suggestion = { afterDay: number; settlement: { id: string; name: string; kind: string; latitude: number; longitude: number; detourKm: number } };
type Plan = { needed: boolean; days: number; suggestions: Suggestion[]; note: string };

/** Shows overnight stop suggestions for long trips as soon as the trip opens. Nothing is added until the user accepts. */
export function OvernightSuggestions({ tripId, version, onAccepted }: { tripId: string; version: number; onAccepted: () => Promise<void> }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    api<Plan>(`/api/trips/${tripId}/overnight`)
      .then((data) => active && setPlan(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [tripId, version]);

  if (failed || !plan || !plan.needed) return null;
  const visible = plan.suggestions.filter((item) => !dismissed.has(item.settlement.id));

  async function accept(item: Suggestion) {
    setBusyId(item.settlement.id);
    try {
      await api(`/api/trips/${tripId}/overnight/accept`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: version, name: item.settlement.name, latitude: item.settlement.latitude, longitude: item.settlement.longitude }),
      });
      await onAccepted();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="Overnight stop suggestions" className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
      <h3 className="font-semibold text-indigo-900">Overnight stops for a {plan.days}-day drive</h3>
      <p className="mt-1 text-xs text-indigo-900">{plan.note}</p>
      {visible.length === 0 ? (
        <p className="mt-2 text-xs text-indigo-900">No suitable overnight towns were found near the planned breaks.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {visible.map((item) => (
            <li key={item.settlement.id} className="flex items-center justify-between gap-2 rounded bg-white p-2">
              <span className="text-xs">
                <span className="font-medium text-slate-900">After day {item.afterDay}: {item.settlement.name}</span>
                <span className="block text-slate-600">
                  {item.settlement.kind} · about {item.settlement.detourKm} km from the route
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" disabled={busyId !== null} onClick={() => accept(item)} className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
                  {busyId === item.settlement.id ? "Adding..." : "Add"}
                </button>
                <button type="button" onClick={() => setDismissed((prev) => new Set(prev).add(item.settlement.id))} className="rounded border border-slate-300 px-2 py-1 text-xs">
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

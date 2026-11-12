"use client";

import { useState } from "react";
import type { TripView } from "@/server/tripService";
import type { TripOperation } from "@/domain/trip";
import { formatDistance, formatDuration } from "@/lib/format";
import { PlaceSearch, type ChosenPlace } from "../PlaceSearch";
import { ImportStops } from "./ImportStops";
import type { ImportCommitRow } from "./useTrip";

type Props = {
  trip: TripView;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  apply: (operations: TripOperation[], summary: string) => Promise<boolean>;
  commitImport: (rows: ImportCommitRow[]) => Promise<boolean>;
  confirmRemove: (stopName: string) => boolean;
  retryRoutes: () => Promise<void>;
};

const TYPE_BADGE: Record<string, string> = {
  origin: "bg-emerald-100 text-emerald-800",
  destination: "bg-rose-100 text-rose-800",
  required: "bg-sky-100 text-sky-900",
  optional: "bg-white text-sky-900 ring-1 ring-sky-300",
  return: "bg-slate-200 text-slate-800",
  poi: "bg-violet-100 text-violet-800",
};
const TYPE_TEXT: Record<string, string> = { origin: "Start", destination: "Destination", required: "Required", optional: "Optional", return: "Return to start" };

export function ItineraryPanel({ trip, selectedStopId, onSelectStop, apply, commitImport, confirmRemove, retryRoutes }: Props) {
  const [chosen, setChosen] = useState<ChosenPlace | null>(null);
  const [retrying, setRetrying] = useState(false);
  const roundTrip = trip.stops.some((stop) => stop.stopType === "return");
  const [addType, setAddType] = useState<"required" | "optional">("required");
  const [addLeg, setAddLeg] = useState<"outbound" | "return">("outbound");
  const [addOvernight, setAddOvernight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const stopsById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const intermediate = trip.stops.filter((stop) => stop.stopType === "required" || stop.stopType === "optional");

  async function addStop() {
    if (!chosen) return;
    setAdding(true);
    const ok = await apply(
      [{ type: "add_stop", name: chosen.name, address: chosen.label, latitude: chosen.latitude, longitude: chosen.longitude, stopType: addType, leg: addLeg, overnight: addOvernight, source: "user", notes: "", visitMinutes: null }],
      `Added ${chosen.name}`,
    );
    setAdding(false);
    if (ok) setChosen(null);
  }

  async function move(stopId: string, toIndex: number) {
    await apply([{ type: "move_stop", stopId, toIndex }], "Reordered stops");
  }

  async function remove(stopId: string) {
    const stop = stopsById.get(stopId);
    if (!stop) return;
    const required = stop.stopType === "required";
    if (required && !confirmRemove(stop.name)) return;
    await apply([{ type: "remove_stop", stopId, confirmRequired: required }], `Removed ${stop.name}`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-200 p-4">
        {importing ? (
          <ImportStops tripId={trip.id} commit={commitImport} onClose={() => setImporting(false)} />
        ) : (
          <button type="button" onClick={() => setImporting(true)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            Import a stop list (CSV or XLSX)
          </button>
        )}
        <button
          type="button"
          onClick={() => apply([{ type: "set_round_trip", enabled: !roundTrip }], roundTrip ? "Changed to one way" : "Changed to round trip")}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          {roundTrip ? "Trip is round trip. Make it one way" : "Trip is one way. Make it round trip"}
        </button>
        <h2 className="text-base font-semibold text-slate-900">Add a stop</h2>
        <PlaceSearch label="Search a place" onChoose={setChosen} />
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Stop type</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="stop-type" checked={addType === "required"} onChange={() => setAddType("required")} /> Required
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="stop-type" checked={addType === "optional"} onChange={() => setAddType("optional")} /> Optional
          </label>
        </fieldset>
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Leg of the trip</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="stop-leg" checked={addLeg === "outbound"} onChange={() => setAddLeg("outbound")} /> Outbound
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="stop-leg" checked={addLeg === "return"} onChange={() => setAddLeg("return")} /> Return trip
          </label>
        </fieldset>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={addOvernight} onChange={(e) => setAddOvernight(e.target.checked)} />
          Overnight stop (the day&apos;s driving ends here)
        </label>
        <button type="button" disabled={!chosen || adding} onClick={addStop} className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          {adding ? "Adding..." : "Add to trip"}
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-label="Day-by-day itinerary">
        {trip.itinerary.warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" aria-label="Itinerary warnings">
            {trip.itinerary.warnings.map((warning) => (
              <li key={warning}>⚠ {warning}</li>
            ))}
          </ul>
        )}
        {trip.routeErrors.length > 0 && (
          <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            <p className="font-medium">Some routes could not be calculated. Your stops were saved.</p>
            <ul className="mt-1 list-disc pl-5">{trip.routeErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                await retryRoutes();
                setRetrying(false);
              }}
              className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            >
              {retrying ? "Retrying..." : "Retry route calculation"}
            </button>
          </div>
        )}
        <p className="text-xs text-slate-500">
          Totals: {formatDistance(trip.itinerary.totals.distanceMeters)} · {formatDuration(trip.itinerary.totals.driveDurationSeconds)} driving (provider estimate, excludes breaks and traffic) · {trip.itinerary.totals.drivingDays} driving day(s)
        </p>

        {trip.itinerary.days.map((day) => (
          <section key={day.dayNumber} aria-labelledby={`day-${day.dayNumber}`} className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <h3 id={`day-${day.dayNumber}`} className="text-sm font-semibold text-slate-900">
                Day {day.dayNumber}
                {day.date ? <span className="ml-2 font-normal text-slate-500">{day.date}</span> : null}
                {day.kind === "rest" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-600">No driving</span>}
              </h3>
              <span className="text-xs text-slate-600">
                {formatDistance(day.driveDistanceMeters)} · {formatDuration(day.driveDurationSeconds)} · visits ~{formatDuration(day.visitMinutes * 60)} (est.)
              </span>
            </header>
            {day.warnings.length > 0 && <p className="bg-amber-50 px-3 py-1 text-xs text-amber-900">{day.warnings.join(" ")}</p>}
            <ol className="divide-y divide-slate-100">
              {day.items.map((item) => {
                const stop = stopsById.get(item.stopId);
                if (!stop) return null;
                const isSelected = selectedStopId === stop.id;
                const position = intermediate.findIndex((s) => s.id === stop.id);
                const movable = position >= 0;
                return (
                  <li key={`${day.dayNumber}-${item.stopId}`} className={`p-3 ${isSelected ? "bg-amber-50" : ""}`}>
                    <div className="flex items-start gap-2">
                      <button type="button" onClick={() => onSelectStop(stop.id)} aria-pressed={isSelected} className="flex-1 text-left focus:outline-none focus:ring-2 focus:ring-sky-400 rounded">
                        <span className="font-medium text-slate-900">{stop.name}</span>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${TYPE_BADGE[stop.source === "poi" ? "poi" : stop.stopType]}`}>
                          {stop.source === "poi" ? "From recommendations" : TYPE_TEXT[stop.stopType]}
                        </span>
                        {item.fromPrevious && (
                          <span className="mt-0.5 block text-xs text-slate-600">
                            {item.fromPrevious.status === "ok" ? `${formatDistance(item.fromPrevious.distanceMeters)} · ${formatDuration(item.fromPrevious.durationSeconds)} driving from previous` : "Route not calculated yet"}
                          </span>
                        )}
                        {item.stopType !== "origin" && (
                          <span className="block text-xs text-slate-500">Visit ~{formatDuration(item.visitMinutes * 60)}{item.visitMinutesIsEstimate ? " (estimate)" : ""}</span>
                        )}
                        {day.overnightStopId === stop.id && <span className="block text-xs font-medium text-indigo-700">Overnight stop</span>}
                      </button>
                      {movable && (
                        <div className="flex shrink-0 gap-1">
                          <button type="button" aria-label={`Move ${stop.name} earlier`} disabled={position === 0} onClick={() => move(stop.id, position - 1)} className="rounded border px-2 py-0.5 text-sm disabled:opacity-30">↑</button>
                          <button type="button" aria-label={`Move ${stop.name} later`} disabled={position === intermediate.length - 1} onClick={() => move(stop.id, position + 1)} className="rounded border px-2 py-0.5 text-sm disabled:opacity-30">↓</button>
                          <button type="button" aria-label={`Remove ${stop.name}`} onClick={() => remove(stop.id)} className="rounded border border-rose-200 px-2 py-0.5 text-sm text-rose-700">✕</button>
                        </div>
                      )}
                    </div>
                    {isSelected && <StopEditor key={stop.id + stop.visitMinutes + stop.notes} stop={stop} apply={apply} />}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function StopEditor({ stop, apply }: { stop: TripView["stops"][number]; apply: Props["apply"] }) {
  const [notes, setNotes] = useState(stop.notes);
  const [minutes, setMinutes] = useState(stop.visitMinutes?.toString() ?? "");
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm">
      <label className="block">
        Visit length (minutes, leave blank to use the estimate)
        <input
          type="number"
          min={0}
          max={1440}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          onBlur={() => {
            const next = minutes === "" ? null : Number(minutes);
            if (next !== stop.visitMinutes) apply([{ type: "update_stop", stopId: stop.id, visitMinutes: next }], `Updated visit length for ${stop.name}`);
          }}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      <label className="block">
        Notes
        <textarea
          value={notes}
          maxLength={1000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== stop.notes) apply([{ type: "update_stop", stopId: stop.id, notes }], `Updated notes for ${stop.name}`);
          }}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          rows={2}
        />
      </label>
      {(stop.stopType === "required" || stop.stopType === "optional") && (
        <button
          type="button"
          className="justify-self-start rounded border border-slate-300 px-2 py-1 text-xs"
          onClick={() => apply([{ type: "update_stop", stopId: stop.id, stopType: stop.stopType === "required" ? "optional" : "required" }], `Marked ${stop.name} as ${stop.stopType === "required" ? "optional" : "required"}`)}
        >
          Mark as {stop.stopType === "required" ? "optional" : "required"}
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { TripView } from "@/server/tripService";
import type { Hotel, TripOperation } from "@/domain/trip";
import { formatDistance, formatDuration } from "@/lib/format";
import { PlaceSearch, type ChosenPlace } from "../PlaceSearch";
import { ImportStops } from "./ImportStops";
import type { ImportCommitRow } from "./useTrip";
import { filterHotels, locateAddress, type HotelSearch, type PendingHotel } from "./hotelSearch";
import type { HotelCandidate } from "@/services/types";

type Props = {
  trip: TripView;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  apply: (operations: TripOperation[], summary: string) => Promise<boolean>;
  commitImport: (rows: ImportCommitRow[]) => Promise<boolean>;
  confirmRemove: (stopName: string) => boolean;
  retryRoutes: () => Promise<void>;
  hotelSearch: HotelSearch | null;
  onSearchHotels: (stopId: string) => Promise<void>;
  onPickHotel: (id: string) => void;
  onFilterHotels: (query: string) => void;
  onPendingHotel: (hotel: PendingHotel | null) => void;
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

export function ItineraryPanel({ trip, selectedStopId, onSelectStop, apply, commitImport, confirmRemove, retryRoutes, hotelSearch, onSearchHotels, onPickHotel, onFilterHotels, onPendingHotel }: Props) {
  const [chosen, setChosen] = useState<ChosenPlace | null>(null);
  const [retrying, setRetrying] = useState(false);
  const roundTrip = trip.stops.some((stop) => stop.stopType === "return");
  const [addType, setAddType] = useState<"required" | "optional">("required");
  const [addLeg, setAddLeg] = useState<"outbound" | "return">("outbound");
  const [addOvernight, setAddOvernight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const stopsById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  // An overnight stop appears twice: at the end of one day and the start of the next. Its editor belongs to the first.
  const firstAppearance = new Map<string, string>();
  trip.itinerary.days.forEach((day) =>
    day.items.forEach((item) => {
      if (!firstAppearance.has(item.stopId)) firstAppearance.set(item.stopId, `${day.dayNumber}-${item.stopId}`);
    }),
  );
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
                {formatDistance(day.driveDistanceMeters)} · {formatDuration(day.driveDurationSeconds)}
              </span>
            </header>
            {day.kind === "rest" && day.startStopId && (
              <p className="px-3 py-2 text-xs text-slate-600">
                Staying at {stopsById.get(day.startStopId)?.name}
                {stopsById.get(day.startStopId)?.hotels.map((hotel) => ` · ${hotel.name}`).join("")}
              </p>
            )}
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
                    {isSelected && firstAppearance.get(stop.id) === `${day.dayNumber}-${item.stopId}` && (
                      <StopEditor
                        key={stop.id + stop.visitMinutes + stop.notes}
                        stop={stop}
                        apply={apply}
                        hotelSearch={hotelSearch?.stopId === stop.id ? hotelSearch : null}
                        onSearchHotels={onSearchHotels}
                        onPickHotel={onPickHotel}
                        onFilterHotels={onFilterHotels}
                        onPendingHotel={onPendingHotel}
                      />
                    )}
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

type StopEditorProps = {
  stop: TripView["stops"][number];
  apply: Props["apply"];
  hotelSearch: HotelSearch | null;
  onSearchHotels: Props["onSearchHotels"];
  onPickHotel: Props["onPickHotel"];
  onFilterHotels: Props["onFilterHotels"];
  onPendingHotel: Props["onPendingHotel"];
};

function StopEditor({ stop, apply, hotelSearch, onSearchHotels, onPickHotel, onFilterHotels, onPendingHotel }: StopEditorProps) {
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
      {stop.stopType !== "origin" && stop.stopType !== "return" && (
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={stop.overnight} onChange={(event) => apply([{ type: "update_stop", stopId: stop.id, overnight: event.target.checked }], `Updated ${stop.name}`)} />
          Overnight stop
        </label>
      )}
      {(stop.stopType === "required" || stop.stopType === "optional") && (
        <button
          type="button"
          className="justify-self-start rounded border border-slate-300 px-2 py-1 text-xs"
          onClick={() => apply([{ type: "update_stop", stopId: stop.id, stopType: stop.stopType === "required" ? "optional" : "required" }], `Marked ${stop.name} as ${stop.stopType === "required" ? "optional" : "required"}`)}
        >
          Mark as {stop.stopType === "required" ? "optional" : "required"}
        </button>
      )}
      {stop.overnight && <HotelEditor stop={stop} apply={apply} hotelSearch={hotelSearch} onSearchHotels={onSearchHotels} onPickHotel={onPickHotel} onFilterHotels={onFilterHotels} onPendingHotel={onPendingHotel} />}
    </div>
  );
}

type HotelEditorProps = Pick<StopEditorProps, "apply" | "hotelSearch" | "onSearchHotels" | "onPickHotel" | "onFilterHotels" | "onPendingHotel"> & { stop: TripView["stops"][number] };

function HotelEditor({ stop, apply, hotelSearch, onSearchHotels, onPickHotel, onFilterHotels, onPendingHotel }: HotelEditorProps) {
  const [searching, setSearching] = useState(false);
  const totalNights = stop.hotels.reduce((sum, hotel) => sum + hotel.nights, 0);
  const picked = hotelSearch?.hotels.find((hotel) => hotel.externalId === hotelSearch.pickedId) ?? null;
  const visibleHotels = hotelSearch ? filterHotels(hotelSearch.hotels, hotelSearch.query) : [];

  async function searchHotels() {
    setSearching(true);
    await onSearchHotels(stop.id);
    setSearching(false);
  }

  return (
    <div className="grid gap-2">
      <h4 className="font-medium text-slate-900">Hotels</h4>
      <p className="text-xs text-slate-500">{stop.hotels.length ? `${totalNights} night(s) planned here in total.` : "No hotel yet. One night is planned."}</p>
      {stop.hotels.map((hotel, index) => (
        <HotelRow key={hotel.id} stopId={stop.id} hotel={hotel} label={`Hotel ${index + 1}`} apply={apply} />
      ))}
      <button type="button" disabled={searching} onClick={searchHotels} className="justify-self-start rounded border border-sky-300 px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50">
        {searching ? "Searching..." : "Find hotels within 10 miles"}
      </button>
      {hotelSearch && (
        <>
          <input
            type="search"
            aria-label="Filter hotels"
            placeholder="Filter by name or address"
            value={hotelSearch.query}
            onChange={(event) => onFilterHotels(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <ul className="grid gap-1" aria-label="Hotels found nearby">
            {hotelSearch.hotels.length === 0 && <li className="text-xs text-slate-500">No hotels found within 10 miles. Enter one below.</li>}
            {hotelSearch.hotels.length > 0 && visibleHotels.length === 0 && <li className="text-xs text-slate-500">No hotels match this filter.</li>}
            {visibleHotels.map((hotel) => {
            const isPicked = hotel.externalId === hotelSearch.pickedId;
            return (
              <li key={hotel.externalId}>
                <button type="button" aria-pressed={isPicked} onClick={() => onPickHotel(hotel.externalId)} className={`w-full rounded border px-2 py-1 text-left text-xs ${isPicked ? "border-pink-600 bg-pink-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <span className="block font-medium text-slate-900">{hotel.name}</span>
                  {hotel.address && <span className="block text-slate-600">{hotel.address}</span>}
                </button>
              </li>
            );
          })}
          </ul>
        </>
      )}
      <NewHotelForm key={picked?.externalId ?? "blank"} stop={stop} apply={apply} prefill={picked} onPending={onPendingHotel} />
    </div>
  );
}

/** Keyed by the picked hotel in HotelEditor, so picking another hotel starts the form again with its name and address. */
function NewHotelForm({ stop, apply, prefill, onPending }: { stop: TripView["stops"][number]; apply: Props["apply"]; prefill: HotelCandidate | null; onPending: Props["onPendingHotel"] }) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [nights, setNights] = useState("1");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(prefill ? { latitude: prefill.latitude, longitude: prefill.longitude } : null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Leaving the form, or switching to another stop, removes the unsaved preview from the map.
  useEffect(() => () => onPending(null), [onPending]);

  async function locate() {
    setLocating(true);
    setLocateError(null);
    try {
      const located = await locateAddress(address.trim() || name.trim());
      setCoords(located);
      onPending({ name: name.trim() || address.trim(), ...located });
    } catch (err) {
      setCoords(null);
      onPending(null);
      setLocateError(err instanceof Error ? err.message : "Could not find that address.");
    } finally {
      setLocating(false);
    }
  }

  async function addHotel() {
    const ok = await apply(
      [{ type: "add_hotel", stopId: stop.id, name: name.trim(), address: address.trim(), nights: Number(nights), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null }],
      `Added a hotel at ${stop.name}`,
    );
    if (ok) {
      setName("");
      setAddress("");
      setNights("1");
      setCoords(null);
      onPending(null);
    }
  }

  return (
    <div className="grid gap-2 rounded border border-dashed border-slate-300 bg-white p-2">
      <input aria-label="New hotel name" placeholder="Hotel name" value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      <input
        aria-label="New hotel address"
        placeholder="Address"
        value={address}
        onChange={(event) => {
          setAddress(event.target.value);
          setCoords(null);
          onPending(null);
        }}
        className="rounded border border-slate-300 px-2 py-1"
      />
      <label className="flex items-center gap-2">
        Nights
        <input type="number" min={1} max={30} value={nights} onChange={(event) => setNights(event.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" />
      </label>
      <LocateButton located={coords !== null} locating={locating} disabled={!(address.trim() || name.trim())} onLocate={locate} />
      {locateError && <p className="text-xs text-rose-700">{locateError}</p>}
      <button type="button" disabled={!name.trim()} onClick={addHotel} className="justify-self-start rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
        Add hotel
      </button>
    </div>
  );
}

/** Geocodes the typed address so the hotel can be shown on the map. Shows whether it is already located. */
function LocateButton({ located, locating, disabled, onLocate }: { located: boolean; locating: boolean; disabled: boolean; onLocate: () => void }) {
  return (
    <button type="button" disabled={disabled || locating} onClick={onLocate} className="justify-self-start rounded border border-sky-300 px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50">
      {locating ? "Locating..." : located ? "On map · locate again" : "Locate on map"}
    </button>
  );
}

function HotelRow({ stopId, hotel, label, apply }: { stopId: string; hotel: Hotel; label: string; apply: Props["apply"] }) {
  const [name, setName] = useState(hotel.name);
  const [address, setAddress] = useState(hotel.address);
  const [nights, setNights] = useState(String(hotel.nights));
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function save() {
    const next = { name: name.trim(), address: address.trim(), nights: Number(nights) };
    if (next.name === hotel.name && next.address === hotel.address && next.nights === hotel.nights) return;
    const moved = next.address !== hotel.address;
    apply([{ type: "update_hotel", stopId, hotelId: hotel.id, ...next, ...(moved ? { latitude: null, longitude: null } : {}) }], `Updated ${hotel.name}`);
  }

  async function locate() {
    setLocating(true);
    setLocateError(null);
    try {
      const coords = await locateAddress(address.trim() || name.trim());
      await apply([{ type: "update_hotel", stopId, hotelId: hotel.id, ...coords }], `Located ${hotel.name} on the map`);
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : "Could not find that address.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="grid gap-2 rounded border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <button type="button" onClick={() => apply([{ type: "remove_hotel", stopId, hotelId: hotel.id }], `Removed ${hotel.name}`)} className="text-xs text-rose-700 hover:underline">
          Remove
        </button>
      </div>
      <input aria-label={`${label} name`} value={name} onChange={(event) => setName(event.target.value)} onBlur={save} className="rounded border border-slate-300 px-2 py-1" />
      <input aria-label={`${label} address`} value={address} onChange={(event) => setAddress(event.target.value)} onBlur={save} placeholder="Address" className="rounded border border-slate-300 px-2 py-1" />
      <label className="flex items-center gap-2">
        Nights
        <input type="number" min={1} max={30} value={nights} onChange={(event) => setNights(event.target.value)} onBlur={save} className="w-20 rounded border border-slate-300 px-2 py-1" />
      </label>
      <LocateButton located={hotel.latitude != null} locating={locating} disabled={!(address.trim() || name.trim())} onLocate={locate} />
      {locateError && <p className="text-xs text-rose-700">{locateError}</p>}
    </div>
  );
}

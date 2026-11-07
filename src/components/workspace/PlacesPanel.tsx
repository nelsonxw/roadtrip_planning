"use client";

import { useState } from "react";
import type { TripView, PlaceView } from "@/server/tripService";
import { formatDistance, formatDuration } from "@/lib/format";

type Props = {
  trip: TripView;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string | null) => void;
  discover: () => Promise<boolean>;
  setStatus: (id: string, status: "suggested" | "saved" | "dismissed") => Promise<boolean>;
  addToTrip: (place: PlaceView) => Promise<boolean>;
};

export function PlacesPanel({ trip, selectedPlaceId, onSelectPlace, discover, setStatus, addToTrip }: Props) {
  const [discovering, setDiscovering] = useState(false);
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(trip.places.map((p) => p.category))).sort();
  const visible = trip.places.filter((p) => p.status !== "dismissed" && (category === "all" || p.category === category));
  const selected = trip.places.find((p) => p.id === selectedPlaceId) ?? null;

  async function runDiscovery() {
    setDiscovering(true);
    await discover();
    setDiscovering(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-4">
        <button type="button" onClick={runDiscovery} disabled={discovering || trip.routeGeometry.length < 2} className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {discovering ? "Searching along your route..." : trip.places.length ? "Refresh places along route" : "Find places along route"}
        </button>
        <p className="text-xs text-slate-500">
          Places come from OpenStreetMap, with text from Wikipedia and licensed Wikimedia Commons photos. Visit lengths are estimates. Opening hours are not shown because they are not verified.
        </p>
        {trip.places.length > 0 && (
          <label className="block text-xs font-medium text-slate-700">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {selected && <PlaceCard place={selected} onClose={() => onSelectPlace(null)} onStatus={setStatus} onAdd={addToTrip} />}
        {trip.places.length === 0 ? (
          <p className="text-sm text-slate-600">No places yet. Search along the route to see attractions, parks and viewpoints.</p>
        ) : (
          <ul className="mt-3 space-y-2" aria-label="Places along the route">
            {visible.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => onSelectPlace(place.id)}
                  aria-pressed={place.id === selectedPlaceId}
                  className={`w-full rounded-lg border p-3 text-left hover:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-400 ${place.id === selectedPlaceId ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white"}`}
                >
                  <span className="block font-medium text-slate-900">{place.name}</span>
                  <span className="block text-xs text-slate-600">
                    {place.category}
                    {place.detourDistanceMeters !== null ? ` · ~${formatDistance(place.detourDistanceMeters)} from route (straight line)` : ""}
                    {place.status === "added" ? " · in itinerary" : place.status === "saved" ? " · saved" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlaceCard({ place, onClose, onStatus, onAdd }: { place: PlaceView; onClose: () => void; onStatus: Props["setStatus"]; onAdd: Props["addToTrip"] }) {
  const inItinerary = place.status === "added";
  return (
    <article aria-label={`Details for ${place.name}`} className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {place.image ? (
        // Images are shown only with licence metadata. The attribution line is always displayed with them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={place.image.url} alt={`Photo of ${place.name}`} loading="lazy" className="h-40 w-full object-cover" />
      ) : (
        <div role="img" aria-label="No verified photo available" className="flex h-24 items-center justify-center bg-slate-100 text-xs text-slate-500">
          No verified photo available
        </div>
      )}
      <div className="space-y-2 p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{place.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close details" className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <p className="text-xs text-slate-600">{place.category}{place.address ? ` · ${place.address}` : ""}</p>
        {place.description ? <p className="text-slate-700">{place.description}</p> : <p className="text-xs italic text-slate-500">No description from the source.</p>}
        <dl className="grid grid-cols-2 gap-1 text-xs text-slate-700">
          <dt className="text-slate-500">Detour (straight line)</dt>
          <dd>{place.detourDistanceMeters !== null ? formatDistance(place.detourDistanceMeters) : "Unknown"}</dd>
          <dt className="text-slate-500">Visit length</dt>
          <dd>{place.visitMinutes ? `~${formatDuration(place.visitMinutes * 60)} (estimate)` : "Unknown"}</dd>
          <dt className="text-slate-500">Opening hours</dt>
          <dd>Not verified</dd>
        </dl>
        {place.image && <p className="text-[11px] text-slate-500">Photo: {place.image.attribution}, {place.image.license} · <a className="underline" href={place.image.sourceUrl ?? "#"} target="_blank" rel="noreferrer">source</a></p>}
        <p className="text-[11px] text-slate-500">Source: {place.source}{place.sourceUrl ? <> · <a className="text-sky-700 underline" href={place.sourceUrl} target="_blank" rel="noreferrer">view page</a></> : null}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={inItinerary} onClick={() => onAdd(place)} className="rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {inItinerary ? "In itinerary" : "Add to trip"}
          </button>
          <button type="button" disabled={inItinerary} onClick={() => onStatus(place.id, place.status === "saved" ? "suggested" : "saved")} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">
            {place.status === "saved" ? "Unsave" : "Save for later"}
          </button>
          <button type="button" disabled={inItinerary} onClick={() => onStatus(place.id, "dismissed")} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">
            Dismiss
          </button>
        </div>
      </div>
    </article>
  );
}

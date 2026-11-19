"use client";

import { useState } from "react";
import type { PopularPlacesResult } from "@/server/popularPlaces";
import type { TripView } from "@/server/tripService";

type Props = {
  trip: TripView;
  popular: PopularPlacesResult | null;
  askingPopular: boolean;
  popularError: string | null;
  onAskPopular: (includeEndpoints: boolean) => void;
};

/** Numbers match the diamonds on the map, so a suggestion can be found from either place. */
export function PlacesPanel({ trip, popular, askingPopular, popularError, onAskPopular }: Props) {
  const [lastChoice, setLastChoice] = useState<boolean | null>(null);
  const disabled = askingPopular || trip.routeGeometry.length < 2;
  const failed = popular?.status === "unavailable" || popularError !== null;
  const ask = (includeEndpoints: boolean) => {
    setLastChoice(includeEndpoints);
    onAskPopular(includeEndpoints);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-800">Include places near your start (and return) point?</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => ask(false)} disabled={disabled} className="rounded-lg border border-violet-300 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50">
            No, skip within 50 mi
          </button>
          <button type="button" onClick={() => ask(true)} disabled={disabled} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            Yes, include them
          </button>
        </div>
        {askingPopular && <p className="text-xs text-slate-600">Asking for popular places...</p>}
        {failed && lastChoice !== null && (
          <button type="button" onClick={() => ask(lastChoice)} disabled={disabled} className="w-full rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50">
            Try again
          </button>
        )}
        <p className="text-xs text-slate-500">Within 50 miles of your route. Each suggestion is checked on Wikidata before it is shown. Click a diamond on the map to read about it.</p>
        {popularError && <p role="alert" className="text-xs text-rose-700">{popularError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {popular ? (
          <div className="space-y-2">
            <p className={`text-xs ${popular.status === "unavailable" ? "text-rose-700" : "text-slate-600"}`}>{popular.note}</p>
            <ol className="space-y-2" aria-label="Popular places">
              {popular.places.map((place, index) => (
                <li key={place.wikidataUrl} className="rounded-lg border border-violet-100 bg-white p-3 text-xs">
                  <span className="block font-medium text-slate-900">
                    <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-800 bg-violet-300 px-1 text-[11px] font-semibold text-slate-900">{index + 1}</span>
                    <a href={place.wikipediaUrl ?? place.wikidataUrl} target="_blank" rel="noreferrer" className="underline">{place.name}</a>
                  </span>
                  {place.type && <span className="block text-slate-500">{place.type}</span>}
                  <span className="block text-slate-600">{place.extract || place.reason}</span>
                  <span className="block text-slate-500">{place.distanceMiles} mi from route</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Ask for popular places to see attractions and parks near your route.</p>
        )}
      </div>
    </div>
  );
}

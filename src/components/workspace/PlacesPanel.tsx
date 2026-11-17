"use client";

import type { PopularPlacesResult } from "@/server/popularPlaces";
import type { TripView } from "@/server/tripService";

type Props = {
  trip: TripView;
  popular: PopularPlacesResult | null;
  askingPopular: boolean;
  popularError: string | null;
  onAskPopular: () => void;
};

/** Numbers match the diamonds on the map, so a suggestion can be found from either place. */
export function PlacesPanel({ trip, popular, askingPopular, popularError, onAskPopular }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-4">
        <button type="button" onClick={onAskPopular} disabled={askingPopular || trip.routeGeometry.length < 2} className="w-full rounded-lg border border-violet-300 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50">
          {askingPopular ? "Asking for popular places..." : "Suggest popular places (AI)"}
        </button>
        <p className="text-xs text-slate-500">Within 50 miles of your route and stops. Each suggestion is checked on Wikidata before it is shown. Click a diamond on the map to read about it.</p>
        {popularError && <p role="alert" className="text-xs text-rose-700">{popularError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {popular ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{popular.note}</p>
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

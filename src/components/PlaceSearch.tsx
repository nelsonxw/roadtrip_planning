"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/clientApi";

export type ChosenPlace = { label: string; name: string; latitude: number; longitude: number };
type SearchResponse = { results: ChosenPlace[]; mode: "live" | "demo" };

/**
 * Debounced place autocomplete. The user must pick a result, so the app never guesses a
 * location from free text. A typed-but-unpicked value is shown as unresolved.
 */
export function PlaceSearch({ label, onChoose, initial }: { label: string; onChoose: (place: ChosenPlace | null) => void; initial?: string }) {
  const inputId = useId();
  const [query, setQuery] = useState(initial ?? "");
  const [results, setResults] = useState<ChosenPlace[]>([]);
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [chosen, setChosen] = useState<ChosenPlace | null>(null);

  useEffect(() => {
    if (chosen || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const data = await api<SearchResponse>(`/api/geocode?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        setResults(data.results);
        setMode(data.mode);
        setStatus("idle");
      } catch (error) {
        if (controller.signal.aborted) return;
        setResults([]);
        setStatus("error");
        void error;
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, chosen]);

  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={inputId}
        value={query}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setChosen(null);
          onChoose(null);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        aria-describedby={`${inputId}-hint`}
      />
      <p id={`${inputId}-hint`} className="mt-1 text-xs text-slate-500">
        {chosen ? `Selected: ${chosen.label}` : status === "loading" ? "Searching..." : status === "error" ? "Place search is unavailable right now. Try again in a moment." : "Pick a result from the list. Unselected text is not used."}
        {mode === "demo" && results.length > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">DEMO DATA</span>}
      </p>
      {results.length > 0 && !chosen && query.trim().length >= 2 && (
        <ul role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((place) => (
            <li key={`${place.latitude},${place.longitude},${place.label}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50 focus:bg-sky-50 focus:outline-none"
                onClick={() => {
                  setChosen(place);
                  setQuery(place.label);
                  setResults([]);
                  onChoose(place);
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

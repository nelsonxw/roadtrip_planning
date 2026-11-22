"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/clientApi";

export type ChosenPlace = { label: string; name: string; latitude: number; longitude: number };
type SearchResponse = { results: ChosenPlace[]; mode: "live" | "demo" };

/** Waits for a typing pause before searching, so each keystroke does not use a provider request. */
const SEARCH_PAUSE_MS = 350;
const SEARCH_CACHE_SIZE = 100;
const searchCache = new Map<string, SearchResponse>();

function rememberSearch(key: string, data: SearchResponse) {
  if (searchCache.size >= SEARCH_CACHE_SIZE) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, data);
}

/**
 * Debounced place autocomplete. The user must pick a result, so the app never guesses a
 * location from free text. A typed-but-unpicked value is shown as unresolved.
 */
export function PlaceSearch({ label, onChoose, initial, dark = false }: { label: string; onChoose: (place: ChosenPlace | null) => void; initial?: string; dark?: boolean }) {
  const inputId = useId();
  const [query, setQuery] = useState(initial ?? "");
  const [results, setResults] = useState<ChosenPlace[]>([]);
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const [chosen, setChosen] = useState<ChosenPlace | null>(null);

  useEffect(() => {
    if (chosen || query.trim().length < 2) return;
    const controller = new AbortController();
    const key = query.trim().toLowerCase();
    const timer = setTimeout(async () => {
      const cached = searchCache.get(key);
      if (cached) {
        setResults(cached.results);
        setMode(cached.mode);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      try {
        const data = await api<SearchResponse>(`/api/geocode?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        rememberSearch(key, data);
        setResults(data.results);
        setMode(data.mode);
        setStatus("idle");
      } catch (error) {
        if (controller.signal.aborted) return;
        setResults([]);
        setErrorText(error instanceof Error ? error.message : "Something went wrong.");
        setStatus("error");
      }
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, chosen]);

  return (
    <div className="relative">
      <label htmlFor={inputId} className={`block text-sm font-medium ${dark ? "text-white" : "text-slate-700"}`}>
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
      <p id={`${inputId}-hint`} className={`mt-1 text-xs ${dark ? "text-white/80" : "text-slate-500"}`}>
        {chosen ? `Selected: ${chosen.label}` : status === "loading" ? "Searching..." : status === "error" ? `Place search is unavailable: ${errorText}` : "Pick a result from the list. Unselected text is not used."}
        {mode === "demo" && results.length > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">DEMO DATA</span>}
      </p>
      {results.length > 0 && !chosen && query.trim().length >= 2 && (
        <ul role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg">
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

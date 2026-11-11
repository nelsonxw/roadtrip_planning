"use client";

import { useState } from "react";
import type { PlaceView } from "@/server/tripService";
import { useTrip } from "./useTrip";
import { MapPanel } from "./MapPanel";
import { ItineraryPanel } from "./ItineraryPanel";
import { OvernightSuggestions } from "./OvernightSuggestions";
import { PlacesPanel } from "./PlacesPanel";
import { ChatPanel } from "./ChatPanel";

type MobileTab = "map" | "trip" | "chat";
type SidePanel = "itinerary" | "places";

const STATUS_TEXT = { loading: "Loading…", saved: "All changes saved", saving: "Saving…", error: "Not saved · see message" } as const;

export function TripWorkspace({ tripId }: { tripId: string }) {
  const trip = useTrip(tripId);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");
  const [sidePanel, setSidePanel] = useState<SidePanel>("itinerary");
  const [chatOpen, setChatOpen] = useState(true);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  if (trip.status === "loading" && !trip.trip) return <div className="p-6 text-sm text-slate-600">Loading trip…</div>;
  if (!trip.trip) {
    return (
      <div role="alert" className="m-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
        {trip.error ?? "This trip could not be loaded."}{" "}
        <button type="button" className="underline" onClick={() => trip.reload().catch(() => undefined)}>Try again</button>
      </div>
    );
  }
  const current = trip.trip;
  const busy = trip.status === "saving";

  const applyAndSelect = (operations: Parameters<typeof trip.applyOperations>[0], summary: string) => trip.applyOperations(operations, summary);
  const selectStop = (id: string) => {
    setSelectedStopId(id);
    setSelectedPlaceId(null);
  };
  const selectPlace = (id: string | null) => {
    setSelectedPlaceId(id);
    if (id) setSidePanel("places");
  };
  const addPlace = (place: PlaceView) => trip.runPlaceAction(`/api/trips/${tripId}/places/${place.id}/add`);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-slate-900">{current.name}</h1>
          <p className="text-xs text-slate-600">
            {current.itinerary.days.length} day(s) · {current.stops.length} stops · route provider: {trip.trip.modes.routing === "demo" ? "demo estimate" : "OpenRouteService"}
          </p>
        </div>
        <span role="status" aria-live="polite" className={`rounded-full px-2.5 py-1 text-xs font-medium ${trip.status === "error" ? "bg-rose-100 text-rose-800" : trip.status === "saving" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
          {STATUS_TEXT[trip.status]}
        </span>
        <button type="button" disabled={busy} onClick={() => trip.undo().catch(() => undefined)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Undo last change</button>
        <a href={`/api/trips/${tripId}/export/csv`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Export CSV</a>
        <a href={`/api/trips/${tripId}/export/pdf`} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Export PDF</a>
      </header>

      {trip.error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          <span>{trip.error}</span>
          <button type="button" className="underline" onClick={() => trip.setError(null)}>Dismiss</button>
        </div>
      )}

      <nav aria-label="Workspace sections" className="flex border-b border-slate-200 bg-white md:hidden">
        {(["map", "trip", "chat"] as MobileTab[]).map((tab) => (
          <button key={tab} type="button" aria-pressed={mobileTab === tab} onClick={() => setMobileTab(tab)} className={`flex-1 py-2 text-sm font-medium capitalize ${mobileTab === tab ? "border-b-2 border-sky-600 text-sky-700" : "text-slate-600"}`}>
            {tab === "trip" ? "Itinerary" : tab}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        <aside className={`${mobileTab === "trip" ? "flex" : "hidden"} w-full flex-col border-r border-slate-200 bg-white md:flex md:w-[380px] md:shrink-0`} aria-label="Itinerary and places">
          <div role="tablist" aria-label="Itinerary or places" className="flex border-b border-slate-200 text-sm">
            {(["itinerary", "places"] as SidePanel[]).map((panel) => (
              <button key={panel} role="tab" aria-selected={sidePanel === panel} type="button" onClick={() => setSidePanel(panel)} className={`flex-1 py-2 font-medium capitalize ${sidePanel === panel ? "border-b-2 border-sky-600 text-sky-700" : "text-slate-600"}`}>
                {panel}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {sidePanel === "itinerary" ? (
              <>
                <div className="p-4 pb-0">
                  <OvernightSuggestions tripId={tripId} version={current.version} onAccepted={() => trip.reload()} />
                </div>
              <ItineraryPanel
                trip={current}
                selectedStopId={selectedStopId}
                onSelectStop={selectStop}
                apply={applyAndSelect}
                commitImport={trip.commitImport}
                confirmRemove={(name) => window.confirm(`"${name}" is a required stop. Remove it from the trip?`)}
                retryRoutes={() => trip.reload().catch(() => undefined)}
              />
              </>
            ) : (
              <PlacesPanel
                trip={current}
                selectedPlaceId={selectedPlaceId}
                onSelectPlace={selectPlace}
                discover={() => trip.discoverPlaces()}
                setStatus={(id, status) => trip.setPlaceStatus(id, status)}
                addToTrip={addPlace}
              />
            )}
          </div>
        </aside>

        <main className={`${mobileTab === "map" ? "flex" : "hidden"} min-w-0 flex-1 md:flex`} aria-label="Trip map">
          <div className="min-h-[400px] flex-1">
            <MapPanel
              trip={current}
              selectedStopId={selectedStopId}
              selectedPlaceId={selectedPlaceId}
              onSelectStop={(id) => {
                selectStop(id);
                setSidePanel("itinerary");
              }}
              onSelectPlace={selectPlace}
            />
          </div>
        </main>

        <section className={`${mobileTab === "chat" ? "flex" : "hidden"} w-full flex-col border-l border-slate-200 bg-white md:flex md:shrink-0 ${chatOpen ? "md:w-[340px]" : "md:w-12"}`} aria-label="Trip assistant">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            {chatOpen && <h2 className="text-sm font-semibold text-slate-900">Assistant</h2>}
            <button type="button" className="hidden rounded border px-2 py-0.5 text-xs md:block" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
              {chatOpen ? "Collapse" : "Chat"}
            </button>
          </div>
          {chatOpen && (
            <div className="min-h-0 flex-1">
              <ChatPanel messages={trip.messages} busy={busy} send={trip.sendMessage} decide={(p, action, confirm) => trip.decideProposal(p, action, confirm)} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

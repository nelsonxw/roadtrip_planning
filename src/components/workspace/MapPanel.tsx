"use client";

import * as maplibre from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { TripView } from "@/server/tripService";
import type { Stop } from "@/domain/trip";
import type { HotelCandidate } from "@/services/types";
import type { PendingHotel } from "./hotelSearch";

const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Visual language: shape and label carry the stop type, not colour alone. */
const MARKER_CLASS: Record<Stop["stopType"], string> = {
  origin: "rounded-sm bg-emerald-600 text-white",
  destination: "rounded-sm rotate-45 bg-rose-600 text-white",
  required: "rounded-full bg-sky-700 text-white border-2 border-white",
  optional: "rounded-full bg-white text-sky-800 border-2 border-dashed border-sky-700",
  return: "rounded-sm bg-slate-700 text-white",
};
const TYPE_LABEL: Record<Stop["stopType"], string> = { origin: "Start", destination: "Destination", required: "Required stop", optional: "Optional stop", return: "Return to start" };

type Props = {
  trip: TripView;
  overnightSuggestions: { afterDay: number; settlement: { id: string; name: string; latitude: number; longitude: number; detourMiles: number; population: number } }[];
  /** Dashed preview of the route through the suggested overnight towns. Not saved until a suggestion is accepted. */
  previewGeometry: [number, number][];
  selectedStopId: string | null;
  selectedPlaceId: string | null;
  onSelectStop: (id: string) => void;
  onSelectPlace: (id: string) => void;
  /** Hotels from the latest search near an overnight stop. Shown until the search is cleared. */
  hotelMatches: HotelCandidate[];
  pickedHotelId: string | null;
  onPickHotel: (id: string) => void;
  /** A located address that is not saved yet. Shown as a dot so the user can check it before adding the hotel. */
  pendingHotel: PendingHotel | null;
};

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// MapLibre runs its tile and style work in a web worker. The bundler moves the default worker URL, so
// the worker file is served from /public and set explicitly. Without this the map never reports "loaded".
maplibre.setWorkerUrl("/maplibre-gl-worker.mjs");

const SHORT_LABEL: Record<Stop["stopType"], string | null> = { origin: "S", destination: "E", required: null, optional: null, return: "R" };

/** Centres the map on a hotel and zooms in enough to read its name. */
function flyToPoint(map: MapLibreMap, longitude: number, latitude: number) {
  map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14), duration: 800 });
}

export function MapPanel({ trip, overnightSuggestions, previewGeometry, selectedStopId, selectedPlaceId, onSelectStop, onSelectPlace, hotelMatches, pickedHotelId, onPickHotel, pendingHotel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const popupRef = useRef<Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // Without WebGL the map cannot render. Stops, itinerary and chat still work, so the page shows a message instead of failing.
  const [webgl] = useState(supportsWebGL);
  const fitKey = useRef<string>("");
  const callbacks = useRef({ onSelectStop, onSelectPlace, onPickHotel });
  useEffect(() => {
    callbacks.current = { onSelectStop, onSelectPlace, onPickHotel };
  }, [onSelectStop, onSelectPlace, onPickHotel]);

  useEffect(() => {
    if (!containerRef.current || !webgl) return;
    const markers = markersRef.current;
    const map = new maplibre.Map({ container: containerRef.current, style: MAP_STYLE, center: [-98.5, 39.5], zoom: 3 });
    map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addSource("places", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 40, clusterMaxZoom: 11 });
      map.addSource("overnight", { type: "geojson", data: EMPTY });
      map.addSource("preview", { type: "geojson", data: EMPTY });
      map.addSource("hotels", { type: "geojson", data: EMPTY });
      map.addSource("saved-hotels", { type: "geojson", data: EMPTY });
      map.addSource("pending-hotel", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "preview-line", type: "line", source: "preview", paint: { "line-color": "#4f46e5", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": 0.9 } }, "route-line");
      map.addLayer({
        id: "overnight-halo",
        type: "circle",
        source: "overnight",
        paint: { "circle-radius": 16, "circle-color": "#4f46e5", "circle-opacity": 0.2 },
      });
      map.addLayer({
        id: "overnight-points",
        type: "circle",
        source: "overnight",
        paint: { "circle-radius": 8, "circle-color": "#4f46e5", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
      });
      map.addLayer({
        id: "overnight-labels",
        type: "symbol",
        source: "overnight",
        layout: { "text-field": ["concat", "Night ", ["get", "afterDay"], ": ", ["get", "name"]], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" },
        paint: { "text-color": "#312e81", "text-halo-color": "#ffffff", "text-halo-width": 2 },
      });
      map.addSource("route-return", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#0284c7", "line-width": 4, "line-opacity": 0.85 } });
      map.addLayer({ id: "route-return-line", type: "line", source: "route-return", paint: { "line-color": "#0d9488", "line-width": 4, "line-opacity": 0.85 } });
      map.addLayer({
        id: "place-clusters",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: { "circle-color": "#6d28d9", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 30, 22], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
      });
      map.addLayer({ id: "place-cluster-count", type: "symbol", source: "places", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#ffffff" } });
      map.addLayer({
        id: "place-points",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["match", ["get", "status"], "saved", "#059669", "#facc15"],
          "circle-radius": ["case", ["==", ["get", "sel"], 1], 16, 10],
          "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 4, 2],
          "circle-stroke-color": ["case", ["==", ["get", "sel"], 1], "#ea580c", "#1f2937"],
        },
      });
      map.addLayer({
        id: "place-numbers",
        type: "symbol",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        layout: { "text-field": ["to-string", ["get", "n"]], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#1f2937" },
      });
      map.addLayer({
        id: "hotel-points",
        type: "circle",
        source: "hotels",
        paint: {
          "circle-color": "#be185d",
          "circle-radius": ["case", ["==", ["get", "sel"], 1], 12, 7],
          "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 4, 2],
          "circle-stroke-color": ["case", ["==", ["get", "sel"], 1], "#fbcfe8", "#ffffff"],
        },
      });
      const openHotelPopup = (coordinates: [number, number], name: unknown, address: unknown) => {
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = String(name ?? "");
        content.appendChild(title);
        if (address) {
          const line = document.createElement("div");
          line.className = "text-xs text-slate-600";
          line.textContent = String(address);
          content.appendChild(line);
        }
        popupRef.current?.remove();
        popupRef.current = new maplibre.Popup({ offset: 12 }).setLngLat(coordinates).setDOMContent(content).addTo(map);
      };
      map.addLayer({
        id: "saved-hotel-points",
        type: "circle",
        source: "saved-hotels",
        paint: { "circle-color": "#b45309", "circle-radius": 8, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
      });
      map.addLayer({
        id: "saved-hotel-labels",
        type: "symbol",
        source: "saved-hotels",
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": "#78350f", "text-halo-color": "#ffffff", "text-halo-width": 2 },
      });
      map.addLayer({
        id: "pending-hotel-point",
        type: "circle",
        source: "pending-hotel",
        paint: { "circle-color": "#2563eb", "circle-radius": 10, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
      });
      map.addLayer({
        id: "pending-hotel-label",
        type: "symbol",
        source: "pending-hotel",
        layout: { "text-field": ["concat", ["get", "name"], " (not saved yet)"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": "#1e3a8a", "text-halo-color": "#ffffff", "text-halo-width": 2 },
      });
      map.on("click", "saved-hotel-points", (event) => {
        const feature = event.features?.[0];
        if (feature?.geometry.type === "Point") openHotelPopup(feature.geometry.coordinates as [number, number], feature.properties?.name, feature.properties?.address);
      });
      map.on("click", "hotel-points", (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        openHotelPopup(feature.geometry.coordinates as [number, number], feature.properties?.name, feature.properties?.address);
        if (typeof feature.properties?.id === "string") callbacks.current.onPickHotel(feature.properties.id);
      });
      map.on("click", "place-points", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") callbacks.current.onSelectPlace(id);
      });
      map.on("click", "place-clusters", (event) => {
        const feature = event.features?.[0];
        const source = map.getSource("places") as GeoJSONSource;
        if (!feature || feature.geometry.type !== "Point" || feature.properties?.cluster_id === undefined) return;
        source.getClusterExpansionZoom(feature.properties.cluster_id).then((zoom) => map.easeTo({ center: feature.geometry.type === "Point" ? (feature.geometry.coordinates as [number, number]) : map.getCenter(), zoom }));
      });
      for (const layer of ["place-clusters", "place-points", "hotel-points", "saved-hotel-points"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      // The style draws state lines only from zoom 5. This layer draws them at every zoom, under the style's own boundary lines.
      if (map.getSource("openmaptiles")) {
        map.addLayer(
          {
            id: "state-lines-overview",
            type: "line",
            source: "openmaptiles",
            "source-layer": "boundary",
            maxzoom: 5,
            filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
            paint: { "line-color": "#475569", "line-width": 1.5 },
          },
          map.getLayer("boundary_3") ? "boundary_3" : undefined,
        );
      }
      setMapReady(true);
    });

    return () => {
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [webgl]);

  // Stops are rendered as HTML markers so they can be focusable buttons with accessible names.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ordered = [...trip.stops].sort((a, b) => a.sequence - b.sequence);
    const liveIds = new Set(ordered.map((stop) => stop.id));
    markersRef.current.forEach((entry, id) => {
      if (!liveIds.has(id)) {
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    });
    let intermediateNumber = 0;
    ordered.forEach((stop) => {
      const number = stop.stopType === "required" || stop.stopType === "optional" ? ++intermediateNumber : null;
      const isSelected = stop.id === selectedStopId;
      let entry = markersRef.current.get(stop.id);
      if (!entry) {
        // MapLibre positions the wrapper, so the wrapper is never restyled. The styled button sits inside it.
        const wrapper = document.createElement("div");
        const el = document.createElement("button");
        el.type = "button";
        el.addEventListener("click", () => callbacks.current.onSelectStop(stop.id));
        wrapper.appendChild(el);
        const marker = new maplibre.Marker({ element: wrapper, anchor: "center" }).setLngLat([stop.longitude, stop.latitude]).addTo(map);
        entry = { marker, el };
        markersRef.current.set(stop.id, entry);
      }
      entry.marker.setLngLat([stop.longitude, stop.latitude]);
      entry.el.className = `flex h-7 min-w-7 items-center justify-center px-1 text-xs font-semibold shadow ${MARKER_CLASS[stop.stopType]} ${isSelected ? "ring-4 ring-amber-400" : ""}`;
      entry.el.textContent = SHORT_LABEL[stop.stopType] ?? String(number);
      entry.el.setAttribute("aria-label", `${TYPE_LABEL[stop.stopType]}${number ? ` ${number}` : ""}: ${stop.name}`);
      entry.el.setAttribute("aria-pressed", String(isSelected));
      entry.el.title = stop.name;
    });
  }, [trip.stops, selectedStopId, mapReady]);

  // Route, selected segment, and places are GeoJSON sources updated in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Legs that start at or after the destination are the way back, so they get their own colour.
    const destination = trip.stops.find((stop) => stop.stopType === "destination");
    const isReturnLeg = (fromStopId: string) => {
      const from = trip.stops.find((stop) => stop.id === fromStopId);
      return Boolean(destination && from && from.sequence >= destination.sequence);
    };
    const lineFeatures = (legs: TripView["legs"]) =>
      legs.filter((leg) => leg.geometry.length > 1).map((leg) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: leg.geometry } }));
    (map.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lineFeatures(trip.legs.filter((leg) => !isReturnLeg(leg.fromStopId))),
    });
    (map.getSource("route-return") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lineFeatures(trip.legs.filter((leg) => isReturnLeg(leg.fromStopId))),
    });
    (map.getSource("preview") as GeoJSONSource | undefined)?.setData(
      previewGeometry.length > 1 ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: previewGeometry } }] } : EMPTY,
    );
    (map.getSource("overnight") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: overnightSuggestions.map((item) => ({
        type: "Feature",
        properties: { afterDay: item.afterDay, name: item.settlement.name },
        geometry: { type: "Point", coordinates: [item.settlement.longitude, item.settlement.latitude] },
      })),
    });
    const visiblePlaces = trip.places.filter((place) => place.status !== "dismissed");
    (map.getSource("places") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: visiblePlaces.map((place, index) => ({
        type: "Feature",
        properties: { id: place.id, status: place.status, name: place.name, n: index + 1, sel: place.id === selectedPlaceId ? 1 : 0 },
        geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
      })),
    });
  }, [trip.legs, trip.stops, trip.places, selectedPlaceId, overnightSuggestions, previewGeometry, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("hotels") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: hotelMatches.map((hotel) => ({
        type: "Feature",
        properties: { id: hotel.externalId, name: hotel.name, address: hotel.address, sel: hotel.externalId === pickedHotelId ? 1 : 0 },
        geometry: { type: "Point", coordinates: [hotel.longitude, hotel.latitude] },
      })),
    });
  }, [hotelMatches, pickedHotelId, mapReady]);

  // Hotels saved on overnight stops, drawn once they have an address on the map.
  // A hotel that gets its location for the first time (or moves) brings the map to it.
  const savedHotelKeys = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const located = trip.stops
      .flatMap((stop) => stop.hotels)
      .flatMap((hotel) => (hotel.latitude != null && hotel.longitude != null ? [{ id: hotel.id, name: hotel.name, address: hotel.address, latitude: hotel.latitude, longitude: hotel.longitude }] : []));
    (map.getSource("saved-hotels") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: located.map((hotel) => ({
        type: "Feature",
        properties: { id: hotel.id, name: hotel.name, address: hotel.address },
        geometry: { type: "Point", coordinates: [hotel.longitude, hotel.latitude] },
      })),
    });
    const keys = new Map(located.map((hotel) => [hotel.id, `${hotel.latitude},${hotel.longitude}`]));
    const previous = savedHotelKeys.current;
    savedHotelKeys.current = keys;
    const moved = previous ? located.filter((hotel) => previous.get(hotel.id) !== keys.get(hotel.id)) : [];
    if (moved.length) flyToPoint(map, moved[moved.length - 1].longitude, moved[moved.length - 1].latitude);
  }, [trip.stops, mapReady]);

  // The located-but-unsaved hotel from the add form. Zooms to it each time it is located.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("pending-hotel") as GeoJSONSource | undefined)?.setData(
      pendingHotel
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: pendingHotel.name }, geometry: { type: "Point", coordinates: [pendingHotel.longitude, pendingHotel.latitude] } }] }
        : EMPTY,
    );
    if (pendingHotel) flyToPoint(map, pendingHotel.longitude, pendingHotel.latitude);
  }, [pendingHotel, mapReady]);

  // Zoom to the hotels once per search, so picking one does not move the map.
  const hotelKey = hotelMatches.map((hotel) => hotel.externalId).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !hotelKey) return;
    const bounds = new maplibre.LngLatBounds();
    hotelMatches.forEach((hotel) => bounds.extend([hotel.longitude, hotel.latitude]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelKey, mapReady]);

  // Fit to the route when the set of stops changes, not on every edit, so the map does not jump while the user types notes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || trip.stops.length === 0) return;
    const key = trip.stops.map((stop) => stop.id).join("|");
    if (key === fitKey.current) return;
    fitKey.current = key;
    const bounds = new maplibre.LngLatBounds();
    trip.stops.forEach((stop) => bounds.extend([stop.longitude, stop.latitude]));
    trip.routeGeometry.forEach((point) => bounds.extend(point as [number, number]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 500 });
  }, [trip.stops, trip.routeGeometry, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedPlaceId) return;
    const place = trip.places.find((item) => item.id === selectedPlaceId);
    if (place) map.easeTo({ center: [place.longitude, place.latitude], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  }, [selectedPlaceId, trip.places, mapReady]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" role="region" aria-label="Trip map" />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/95 p-2 text-[11px] text-slate-700 shadow">
        <p className="font-semibold">Legend</p>
        <p>■ Start · ◆ Destination · ● Required · ○ Optional</p>
        <p>● Suggested place · ● Saved place · ● Overnight suggestion</p>
        <p>Route: <span className="text-sky-600">blue = outbound</span> · <span className="text-teal-600">teal = return</span></p>
      </div>
      {trip.modes.routing === "demo" && (
        <div className="absolute left-3 top-3 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 shadow">DEMO ROUTING: distances and times are estimates, not live road data</div>
      )}
      {!webgl && <div role="alert" className="absolute inset-0 flex items-center justify-center bg-slate-100 p-6 text-center text-sm text-slate-700">The map cannot start in this browser (WebGL is unavailable). The itinerary and assistant still work.</div>}
      {webgl && !mapReady && <div className="absolute inset-0 flex items-center justify-center bg-slate-100/70 text-sm text-slate-600">Loading map…</div>}
    </div>
  );
}

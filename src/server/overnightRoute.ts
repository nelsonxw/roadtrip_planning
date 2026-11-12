import { haversineMeters, distanceToLineMeters, type LngLat } from "@/domain/geo";
import { getServices, type Services } from "@/services/providers";
import { getRouteLeg, getTripView } from "./tripService";

export const MAX_PREVIEW_POINTS = 8;

/**
 * Route through the trip's stops with the given points (suggested overnight towns) inserted on the
 * leg they lie closest to. Nothing is saved: this is a preview that matches what accepting would do.
 */
export async function previewRouteThrough(tripId: string, ownerId: string, points: LngLat[], services: Services = getServices()) {
  const view = await getTripView(tripId, ownerId, services);
  const stops = view.stops;
  if (stops.length < 2) return { geometry: [] as LngLat[], errors: 0 };

  const byLeg: LngLat[][] = view.legs.map(() => []);
  for (const point of points) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    view.legs.forEach((leg, index) => {
      if (leg.geometry.length < 2) return;
      const distance = distanceToLineMeters(point, leg.geometry);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0) byLeg[best].push(point);
  }

  let geometry: LngLat[] = [];
  let errors = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const start: LngLat = [stops[i].longitude, stops[i].latitude];
    const end: LngLat = [stops[i + 1].longitude, stops[i + 1].latitude];
    const via = [...byLeg[i]].sort((a, b) => haversineMeters(start, a) - haversineMeters(start, b));
    const chain = [start, ...via, end];
    for (let j = 0; j < chain.length - 1; j++) {
      try {
        const leg = await getRouteLeg(chain[j], chain[j + 1], view.preferences, services);
        geometry = geometry.concat(geometry.length ? leg.geometry.slice(1) : leg.geometry);
      } catch {
        errors++;
      }
    }
  }
  return { geometry, errors };
}

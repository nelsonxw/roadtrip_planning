/** Overnight stop planning. Pure functions: no I/O, so the rules are unit-tested directly. */
import { haversineMeters, type LngLat } from "./geo";

export type SettlementKind = "city" | "town" | "village";

export type Settlement = {
  id: string;
  name: string;
  kind: SettlementKind;
  latitude: number;
  longitude: number;
  /** Position along the whole route, 0 at the start and 1 at the final stop. */
  fraction: number;
  detourMeters: number;
};

export type OvernightSuggestion = {
  /** Day that ends at this stop (1 means the first night). */
  afterDay: number;
  /** Where the route should be split, as a fraction of the whole route. */
  target: number;
  settlement: Settlement;
};

export const MAX_SUGGESTED_DAYS = 10;
export const MAX_DETOUR_METERS = 40000;
/** A settlement further than this from its target split point is not suggested. */
const MAX_FRACTION_OFFSET = 0.12;
/** Keeps suggestions away from the start and end of the route. */
const ENDPOINT_MARGIN = 0.02;
/** Larger places win ties. Population is not available from the places provider, so type stands in for size. */
const SIZE_BONUS: Record<SettlementKind, number> = { city: 0.06, town: 0.03, village: 0 };

/** Cumulative distance in metres at each vertex of a route. */
export function cumulativeMeters(route: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i++) out.push(out[i - 1] + haversineMeters(route[i - 1], route[i]));
  return out;
}

/** Where a point sits along the route, from 0 (start) to 1 (end), using the nearest route vertex. */
export function projectFraction(point: LngLat, route: LngLat[], cumulative: number[]): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  route.forEach((vertex, index) => {
    const distance = haversineMeters(point, vertex);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  });
  const total = cumulative[cumulative.length - 1];
  return total > 0 ? cumulative[nearest] / total : 0;
}

/** How many driving days the total needs at the daily limit. A trip within the limit needs no overnight stop. */
export function drivingDaysNeeded(totalDriveSeconds: number, limitSeconds: number): number {
  if (limitSeconds <= 0 || totalDriveSeconds <= limitSeconds) return 1;
  return Math.min(MAX_SUGGESTED_DAYS, Math.ceil(totalDriveSeconds / limitSeconds));
}

/**
 * Chooses one overnight stop for each split point. For each split, the best settlement is the one
 * closest to the split point, with a bonus for larger places. A split with no settlement close
 * enough is left out rather than forced onto a poor match.
 */
export function chooseOvernightStops(totalDriveSeconds: number, limitSeconds: number, settlements: Settlement[]): OvernightSuggestion[] {
  const days = drivingDaysNeeded(totalDriveSeconds, limitSeconds);
  if (days <= 1) return [];
  const used = new Set<string>();
  const suggestions: OvernightSuggestion[] = [];
  const eligible = settlements.filter((s) => s.detourMeters <= MAX_DETOUR_METERS && s.fraction > ENDPOINT_MARGIN && s.fraction < 1 - ENDPOINT_MARGIN);

  for (let afterDay = 1; afterDay < days; afterDay++) {
    const target = afterDay / days;
    let best: { settlement: Settlement; score: number } | null = null;
    for (const settlement of eligible) {
      if (used.has(settlement.id)) continue;
      const offset = Math.abs(settlement.fraction - target);
      if (offset > MAX_FRACTION_OFFSET) continue;
      const score = offset - SIZE_BONUS[settlement.kind];
      if (!best || score < best.score) best = { settlement, score };
    }
    if (!best) continue;
    used.add(best.settlement.id);
    suggestions.push({ afterDay, target, settlement: best.settlement });
  }
  return suggestions;
}

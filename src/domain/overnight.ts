/** Overnight stop planning. Pure functions: no I/O, so the rules are unit-tested directly. */
import { haversineMeters, type LngLat } from "./geo";

export type Settlement = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Position along the whole route, 0 at the start and 1 at the final stop. */
  fraction: number;
  detourMeters: number;
  /** From Wikidata. Null when no figure is known, and such places are never suggested. */
  population: number | null;
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
export const DEFAULT_MIN_POPULATION = 10000;
export const MIN_POPULATION_OPTIONS = [5000, 10000, 25000, 50000] as const;
/** A settlement further than this share of the route from its target split point is not suggested. */
export const MAX_FRACTION_OFFSET = 0.15;
/** Keeps suggestions away from the start and end of the route. */
const ENDPOINT_MARGIN = 0.02;
/** Consecutive nights must be at least this many days' share of the route apart, so suggestions never cluster. */
const MIN_GAP_DAYS = 0.35;

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

/** Only places with a known population at or above the minimum can be suggested. */
export function isEligible(settlement: Settlement, minPopulation: number): boolean {
  return settlement.population !== null && settlement.population >= minPopulation;
}

/**
 * Chooses one overnight stop for each split point. Candidates must meet the minimum population.
 * Among those close to the split point, the closest wins, with a small bonus for larger places.
 * A split with no eligible place close enough is left out rather than forced onto a poor match.
 */
export function chooseOvernightStops(
  totalDriveSeconds: number,
  limitSeconds: number,
  settlements: Settlement[],
  minPopulation = DEFAULT_MIN_POPULATION,
  existingFractions: number[] = [],
): OvernightSuggestion[] {
  const days = drivingDaysNeeded(totalDriveSeconds, limitSeconds);
  if (days <= 1) return [];
  const used = new Set<string>();
  const suggestions: OvernightSuggestion[] = [];
  const eligible = settlements.filter(
    (s) => isEligible(s, minPopulation) && s.detourMeters <= MAX_DETOUR_METERS && s.fraction > ENDPOINT_MARGIN && s.fraction < 1 - ENDPOINT_MARGIN,
  );
  const minGap = MIN_GAP_DAYS / days;

  // A stop the user has already marked overnight claims the nearest unclaimed night within reach.
  const covered = new Set<number>();
  for (const fraction of existingFractions) {
    let bestNight = -1;
    let bestOffset = Number.POSITIVE_INFINITY;
    for (let afterDay = 1; afterDay < days; afterDay++) {
      const offset = Math.abs(fraction - afterDay / days);
      if (!covered.has(afterDay) && offset <= MAX_FRACTION_OFFSET && offset < bestOffset) {
        bestOffset = offset;
        bestNight = afterDay;
      }
    }
    if (bestNight > 0) covered.add(bestNight);
  }

  for (let afterDay = 1; afterDay < days; afterDay++) {
    if (covered.has(afterDay)) continue;
    const target = afterDay / days;
    let best: { settlement: Settlement; score: number } | null = null;
    for (const settlement of eligible) {
      if (used.has(settlement.id)) continue;
      const offset = Math.abs(settlement.fraction - target);
      if (offset > MAX_FRACTION_OFFSET) continue;
      if (suggestions.some((item) => Math.abs(item.settlement.fraction - settlement.fraction) < minGap)) continue;
      if (existingFractions.some((fraction) => Math.abs(fraction - settlement.fraction) < minGap)) continue;
      const populationBonus = 0.02 * Math.log10((settlement.population ?? minPopulation) / minPopulation);
      const score = offset - populationBonus;
      if (!best || score < best.score) best = { settlement, score };
    }
    if (!best) continue;
    used.add(best.settlement.id);
    suggestions.push({ afterDay, target, settlement: best.settlement });
  }
  return suggestions;
}

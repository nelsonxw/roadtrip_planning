/** [longitude, latitude] pairs, matching GeoJSON order. */
export type LngLat = [number, number];

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from a point to the nearest vertex of a polyline. Route geometry is dense, so this is close enough for detour ranking. */
export function distanceToLineMeters(point: LngLat, line: LngLat[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const vertex of line) best = Math.min(best, haversineMeters(point, vertex));
  return best;
}

/** Picks up to `count` evenly spaced vertices, always including the first and last. */
export function sampleLine(line: LngLat[], count: number): LngLat[] {
  if (line.length <= count) return line;
  const step = (line.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => line[Math.round(i * step)]);
}

export function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

const METERS_PER_MILE = 1609.344;

/** Shows miles for US-style trips, which is the common case for this planner. */
export function formatDistance(meters: number) {
  return `${(meters / METERS_PER_MILE).toFixed(meters < 16093 ? 1 : 0)} mi`;
}

export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

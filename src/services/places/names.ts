/** Lower-case letters and digits only, so "Mesa Verde National Park" and "Mesa Verde National Park." compare equal. */
export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when a Wikipedia or Wikidata label is the place's own name, or clearly contains it (or is contained by it). */
export function titleMatchesPlace(placeName: string, title: string): boolean {
  const place = normalizeName(placeName);
  const article = normalizeName(title);
  if (!place || !article) return false;
  if (place === article) return true;
  return (place.length >= 5 && article.includes(place)) || (article.length >= 5 && place.includes(article));
}

import type { LngLat } from "@/domain/geo";
import { distanceToLineMeters, sampleLine } from "@/domain/geo";
import { TtlCache } from "@/lib/cache";
import { fetchProviderJson } from "@/lib/http";
import type { ImageService, PlaceCandidate, PlaceSearchOptions, PlacesService } from "../types";

const ROUTE_SAMPLE_POINTS = 8;
const ENRICH_LIMIT = 12;
const WIKIPEDIA_LOOKUP_TIMEOUT_MS = 8000;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type CategoryRule = { key: string; pattern: string; category: string; visitMinutes: number };

const CATEGORY_RULES: CategoryRule[] = [
  { key: "tourism", pattern: "^(museum|gallery|artwork)$", category: "Museum & art", visitMinutes: 90 },
  { key: "tourism", pattern: "^(zoo|theme_park)$", category: "Family attraction", visitMinutes: 180 },
  { key: "tourism", pattern: "^viewpoint$", category: "Viewpoint", visitMinutes: 20 },
  { key: "historic", pattern: "^.+$", category: "Historic site", visitMinutes: 45 },
  { key: "leisure", pattern: "^(park|nature_reserve)$", category: "Park & nature", visitMinutes: 120 },
  { key: "natural", pattern: "^.+$", category: "Natural feature", visitMinutes: 60 },
  { key: "tourism", pattern: "^attraction$", category: "Attraction", visitMinutes: 60 },
];

const OVERPASS_CATEGORY_FILTERS = [
  '["tourism"~"^(attraction|viewpoint|museum|gallery|artwork|zoo|theme_park)$"]',
  '["historic"~"^(castle|monument|memorial|ruins|archaeological_site|fort)$"]',
  '["leisure"~"^(park|nature_reserve)$"]',
  '["natural"~"^(peak|waterfall|beach|cave_entrance)$"]',
];

export function categorize(tags: Record<string, string>): CategoryRule | null {
  return CATEGORY_RULES.find((rule) => tags[rule.key] !== undefined && new RegExp(rule.pattern).test(tags[rule.key])) ?? null;
}

export function buildOverpassQuery(points: LngLat[], radiusMeters: number): string {
  const clauses = points.flatMap(([lng, lat]) =>
    OVERPASS_CATEGORY_FILTERS.map((filter) => `nwr(around:${radiusMeters},${lat},${lng})${filter}["name"];`),
  );
  return `[out:json][timeout:25];\n(\n${clauses.join("\n")}\n);\nout center tags 400;`;
}

/** Parses an OSM "wikipedia" tag such as "en:Article title". */
export function parseWikipediaTag(value: string | undefined): { language: string; title: string } | null {
  const match = value?.match(/^([a-z-]{2,12}):(.+)$/);
  return match ? { language: match[1], title: match[2] } : null;
}

type WikipediaSummary = {
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  originalimage?: { source?: string };
};

/**
 * Real places along the route from OpenStreetMap, enriched with Wikipedia text and licensed
 * Wikimedia Commons photos. OSM data is community-maintained and can lack hours or details;
 * those fields are left empty rather than guessed.
 */
export class OverpassPlacesService implements PlacesService {
  readonly provider = "OpenStreetMap (Overpass) + Wikipedia";
  readonly mode = "live" as const;
  private readonly cache = new TtlCache<PlaceCandidate[]>(60 * 60 * 1000, 100);

  constructor(
    private readonly overpassUrl: string,
    private readonly images: ImageService,
    private readonly userAgent: string,
  ) {}

  async searchAlongRoute(routeGeometry: LngLat[], options: PlaceSearchOptions): Promise<PlaceCandidate[]> {
    const samples = sampleLine(routeGeometry, ROUTE_SAMPLE_POINTS);
    const cacheKey = `${options.radiusMeters}:${options.maxResults}:${samples.map((p) => p.map((n) => n.toFixed(3)).join(",")).join("|")}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const data = await fetchProviderJson<{ elements?: OverpassElement[] }>(this.overpassUrl, {
      provider: this.provider,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.userAgent },
      body: new URLSearchParams({ data: buildOverpassQuery(samples, options.radiusMeters) }),
      timeoutMs: 30000,
      retries: 0,
    });

    const routeVertices = sampleLine(routeGeometry, 600);
    const seen = new Set<string>();
    const candidates = (data.elements ?? []).flatMap((element) => {
      const key = `${element.type}/${element.id}`;
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      const rule = element.tags ? categorize(element.tags) : null;
      if (seen.has(key) || !element.tags?.name || lat === undefined || lon === undefined || !rule) return [];
      if (options.categories?.length && !options.categories.includes(rule.category)) return [];
      seen.add(key);
      return [{ element, lat, lon, rule, detour: distanceToLineMeters([lon, lat], routeVertices) }];
    });

    candidates.sort((a, b) => a.detour - b.detour);
    const top = candidates.filter((item) => item.detour <= options.radiusMeters).slice(0, options.maxResults);
    const places = await Promise.all(
      top.map(async (item, index): Promise<PlaceCandidate> => {
        const wikipedia = parseWikipediaTag(item.element.tags?.wikipedia);
        const enrich = index < ENRICH_LIMIT && wikipedia ? await this.enrich(wikipedia.language, wikipedia.title) : null;
        return {
          externalId: `${item.element.type}/${item.element.id}`,
          name: item.element.tags!.name,
          category: item.rule.category,
          latitude: item.lat,
          longitude: item.lon,
          address: [item.element.tags?.["addr:street"], item.element.tags?.["addr:city"]].filter(Boolean).join(", "),
          description: enrich?.description ?? "",
          sourceUrl: enrich?.sourceUrl ?? `https://www.openstreetmap.org/${item.element.type}/${item.element.id}`,
          image: enrich?.image ?? null,
          detourDistanceMeters: Math.round(item.detour),
          visitMinutes: item.rule.visitMinutes,
          source: this.provider,
        };
      }),
    );

    this.cache.set(cacheKey, places);
    return places;
  }

  private async enrich(language: string, title: string) {
    const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const summary = await fetchProviderJson<WikipediaSummary>(url, {
      provider: "Wikipedia",
      headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      timeoutMs: WIKIPEDIA_LOOKUP_TIMEOUT_MS,
      retries: 0,
    }).catch(() => null);
    if (!summary) return null;
    const image = summary.originalimage?.source ? await this.images.findImageForUpload(summary.originalimage.source) : null;
    return {
      description: summary.extract ?? "",
      sourceUrl: summary.content_urls?.desktop?.page ?? null,
      image,
    };
  }
}

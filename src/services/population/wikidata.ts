import { TtlCache } from "@/lib/cache";
import { fetchProviderJson } from "@/lib/http";

const API = "https://www.wikidata.org/w/api.php";
const PROVIDER = "Wikidata";
const POPULATION_PROPERTY = "P1082";

type SearchResponse = { search?: { id: string; description?: string }[] };
type PopulationClaim = {
  mainsnak?: { datavalue?: { value?: { amount?: string } } };
  rank?: string;
  qualifiers?: Record<string, { datavalue?: { value?: { time?: string } } }[]>;
};
type EntityResponse = { entities?: Record<string, { claims?: Record<string, PopulationClaim[]> }> };

/** Wikidata lists many census figures. The current one is the preferred-rank claim with the latest "point in time". */
export function pickCurrentPopulation(claims: PopulationClaim[]): number | null {
  const usable = claims.filter((claim) => claim.rank !== "deprecated");
  const pointInTime = (claim: PopulationClaim) => claim.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? "";
  const preferred = usable.filter((claim) => claim.rank === "preferred");
  const pool = preferred.length ? preferred : usable;
  const latest = [...pool].sort((a, b) => pointInTime(b).localeCompare(pointInTime(a)))[0];
  return parsePopulation(latest?.mainsnak?.datavalue?.value?.amount);
}

/** Parses Wikidata's "+12345" population amount. Returns null when the value is missing or not a number. */
export function parsePopulation(amount: string | undefined): number | null {
  if (!amount) return null;
  const value = Number(amount.replace(/^\+/, ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Looks up a settlement's population on Wikidata. Returns null when Wikidata has no match or no
 * population figure, so the app never guesses a size. Results are cached for a week.
 */
export class WikidataPopulation {
  private readonly cache = new TtlCache<number | null>(7 * 24 * 60 * 60 * 1000, 500);

  constructor(private readonly userAgent: string) {}

  async populationOf(name: string, region: string | null): Promise<number | null> {
    const query = [name, region].filter(Boolean).join(", ");
    const cached = this.cache.get(query);
    if (cached !== undefined) return cached;

    const headers = { "User-Agent": this.userAgent, Accept: "application/json" };
    const search = await fetchProviderJson<SearchResponse>(
      `${API}?${new URLSearchParams({ action: "wbsearchentities", search: query, language: "en", type: "item", limit: "1", format: "json", origin: "*" })}`,
      { provider: PROVIDER, headers, timeoutMs: 8000, retries: 0 },
    ).catch(() => null);
    const id = search?.search?.[0]?.id;
    if (!id) {
      this.cache.set(query, null);
      return null;
    }

    const entity = await fetchProviderJson<EntityResponse>(
      `${API}?${new URLSearchParams({ action: "wbgetentities", ids: id, props: "claims", format: "json", origin: "*" })}`,
      { provider: PROVIDER, headers, timeoutMs: 8000, retries: 0 },
    ).catch(() => null);
    const claims = entity?.entities?.[id]?.claims?.[POPULATION_PROPERTY] ?? [];
    const population = pickCurrentPopulation(claims);
    this.cache.set(query, population);
    return population;
  }
}

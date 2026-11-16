import { ProviderError } from "@/lib/errors";
import type { GeocodeCandidate, GeocodingService } from "../types";

/** Asks the primary geocoder first, and the backup only when the primary provider fails. */
export class FallbackGeocoding implements GeocodingService {
  readonly provider: string;
  readonly mode: GeocodingService["mode"];

  constructor(
    private readonly primary: GeocodingService,
    private readonly backup: GeocodingService,
  ) {
    this.provider = primary.provider;
    this.mode = primary.mode;
  }

  search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.withBackup((service) => service.search(query, limit));
  }

  resolve(query: string, limit: number): Promise<GeocodeCandidate[]> {
    return this.withBackup((service) => service.resolve(query, limit));
  }

  private async withBackup(run: (service: GeocodingService) => Promise<GeocodeCandidate[]>): Promise<GeocodeCandidate[]> {
    try {
      return await run(this.primary);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return run(this.backup);
    }
  }
}

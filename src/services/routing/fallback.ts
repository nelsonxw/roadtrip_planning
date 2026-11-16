import type { LngLat } from "@/domain/geo";
import { ProviderError } from "@/lib/errors";
import type { RouteLeg, RoutingOptions, RoutingService } from "../types";

/** Uses the primary routing provider first, and the backup only when the primary provider fails. */
export class FallbackRouting implements RoutingService {
  readonly provider: string;
  readonly mode: RoutingService["mode"];

  constructor(
    private readonly primary: RoutingService,
    private readonly backup: RoutingService,
  ) {
    this.provider = primary.provider;
    this.mode = primary.mode;
  }

  async route(from: LngLat, to: LngLat, options: RoutingOptions): Promise<RouteLeg> {
    try {
      return await this.primary.route(from, to, options);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return this.backup.route(from, to, options);
    }
  }
}

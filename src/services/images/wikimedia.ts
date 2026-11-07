import { fetchProviderJson } from "@/lib/http";
import { TtlCache } from "@/lib/cache";
import type { ImageInfo, ImageService, ServiceMode } from "../types";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const PROVIDER = "Wikimedia Commons";

type CommonsResponse = {
  query?: {
    pages?: {
      imageinfo?: {
        thumburl?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: string }>;
      }[];
    }[];
  };
};

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/**
 * Returns a Commons photo only when its licence metadata is present. Photos without a
 * known licence are rejected, so the UI falls back to a neutral placeholder.
 */
export class WikimediaImageService implements ImageService {
  readonly mode: ServiceMode = "live";
  private readonly cache = new TtlCache<ImageInfo | null>(6 * 60 * 60 * 1000);

  constructor(private readonly userAgent: string) {}

  async findImageForUpload(uploadUrl: string): Promise<ImageInfo | null> {
    const cached = this.cache.get(uploadUrl);
    if (cached !== undefined) return cached;

    const fileName = decodeURIComponent(uploadUrl.split("/").pop() ?? "");
    const params = new URLSearchParams({
      action: "query",
      titles: `File:${fileName}`,
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "800",
      format: "json",
      formatversion: "2",
    });
    const data = await fetchProviderJson<CommonsResponse>(`${COMMONS_API}?${params}`, {
      provider: PROVIDER,
      headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      timeoutMs: 8000,
    }).catch(() => null);
    const info = data?.query?.pages?.[0]?.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value;
    const url = info?.thumburl;
    const result: ImageInfo | null =
      info && license && url
        ? {
            url,
            sourceUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
            attribution: stripHtml(info.extmetadata?.Artist?.value ?? "Unknown author"),
            license: stripHtml(license),
          }
        : null;
    this.cache.set(uploadUrl, result);
    return result;
  }
}

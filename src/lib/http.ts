import { ProviderError, type ProviderErrorKind } from "./errors";

type FetchJsonOptions = RequestInit & {
  provider: string;
  timeoutMs?: number;
  retries?: number;
};

const RETRY_DELAY_MS = 400;

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status >= 500) return "unavailable";
  return "invalid_response";
}

/**
 * Fetches JSON from an external provider with a timeout, limited retries for transient
 * failures, and conversion of every failure into a ProviderError the UI can explain.
 */
export async function fetchProviderJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const { provider, timeoutMs = 15000, retries = 1, ...init } = options;
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        lastError = new ProviderError(provider, kindForStatus(response.status), `${provider} responded with HTTP ${response.status}.`);
      } else {
        try {
          return (await response.json()) as T;
        } catch {
          throw new ProviderError(provider, "invalid_response", `${provider} returned a response that is not valid JSON.`);
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === "invalid_response") throw error;
        lastError = error;
      } else {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        lastError = new ProviderError(provider, timedOut ? "timeout" : "network", timedOut ? `${provider} did not respond in time.` : `Could not reach ${provider}.`);
      }
    }
    if (!lastError?.retryable) break;
  }
  throw lastError ?? new ProviderError(provider, "unavailable", `${provider} is unavailable.`);
}

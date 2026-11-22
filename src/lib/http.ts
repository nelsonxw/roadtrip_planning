import { ProviderError, type ProviderErrorKind } from "./errors";

type FetchJsonOptions = RequestInit & {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  /** Lets a provider map its own error responses to a kind, for example "no road near this point" to not_found. */
  classifyError?: (status: number, body: string) => ProviderErrorKind | undefined;
};

const RETRY_DELAY_MS = 400;

/** Says what the provider's status means, so the user can act on it (for example a spent quota). */
function messageForStatus(provider: string, status: number): string {
  if (status === 401 || status === 403) return `${provider} refused the request (HTTP ${status}). The API key may be over its quota or disabled.`;
  if (status === 429) return `${provider} is rate limiting requests (HTTP 429). Wait a moment and try again.`;
  return `${provider} responded with HTTP ${status}.`;
}

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
  const { provider, timeoutMs = 15000, retries = 1, classifyError, ...init } = options;
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const kind = classifyError?.(response.status, body) ?? kindForStatus(response.status);
        lastError = new ProviderError(provider, kind, messageForStatus(provider, response.status));
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

import { ProviderError } from "@/lib/errors";
import { fetchProviderJson } from "@/lib/http";

const PROVIDER = "Google Gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type FunctionDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

export type GenerateRequest = { systemInstruction: string; contents: GeminiContent[]; tools: FunctionDeclaration[] };
export type GenerateFn = (request: GenerateRequest) => Promise<GeminiContent>;

type GenerateResponse = { candidates?: { content?: { role?: string; parts?: GeminiPart[] } }[] };

const BUSY_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Google returns 503 when a model is briefly overloaded. Those responses come back quickly, so a
 * couple of short retries usually succeed. Timeouts and rate limits are not retried.
 */
async function requestWithBusyRetry<T>(attempt: () => Promise<T>): Promise<T> {
  for (const delay of BUSY_RETRY_DELAYS_MS) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ProviderError) || error.kind !== "unavailable") throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return attempt();
}

/**
 * Calls the Gemini generateContent endpoint. The key travels in a request header so it never
 * appears in URLs, logs or error messages.
 */
export function createGeminiGenerator(apiKey: string, model: string): GenerateFn {
  return async ({ systemInstruction, contents, tools }) => {
    const data = await requestWithBusyRetry(() =>
      fetchProviderJson<GenerateResponse>(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        provider: PROVIDER,
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools: [{ functionDeclarations: tools }],
          generationConfig: { temperature: 0.2 },
        }),
        // Thinking models can take a while; a slow call is not retried, only a fast 503 is.
        timeoutMs: 60000,
        retries: 0,
      }),
    );
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    if (parts.length === 0) throw new ProviderError(PROVIDER, "invalid_response", "The assistant returned no answer. Try rephrasing.");
    return { role: "model", parts: parts.filter((part) => !part.thought) };
  };
}

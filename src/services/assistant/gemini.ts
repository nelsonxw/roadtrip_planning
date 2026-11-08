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

/**
 * Calls the Gemini generateContent endpoint. The key travels in a request header so it never
 * appears in URLs, logs or error messages.
 */
export function createGeminiGenerator(apiKey: string, model: string): GenerateFn {
  return async ({ systemInstruction, contents, tools }) => {
    const data = await fetchProviderJson<GenerateResponse>(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      provider: PROVIDER,
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        generationConfig: { temperature: 0.2 },
      }),
      // Thinking models can take a while; one slow call should not be retried and doubled.
      timeoutMs: 60000,
      retries: 0,
    });
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    if (parts.length === 0) throw new ProviderError(PROVIDER, "invalid_response", "The assistant returned no answer. Try rephrasing.");
    return { role: "model", parts: parts.filter((part) => !part.thought) };
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateJsonText } from "@/services/assistant/gemini";

describe("generateJsonText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns only the answer text, leaving out the model's reasoning parts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Thinking about {parks}", thought: true }, { text: '{"places":[]}' }] } }],
        }),
      ),
    );
    expect(await generateJsonText("key", "model", "system", "user")).toBe('{"places":[]}');
  });
});

import { expect, it } from "vitest";
import { assertKnowledgeProviderAvailable } from "../src/provider-availability.js";
it.each(["claude", "codex"] as const)(
  "%s pauses on native quota and authentication failures without publishing raw output",
  (provider) => {
    const envelope = (message: string, reset_at?: string) =>
      JSON.stringify(
        provider === "claude"
          ? { type: "result", is_error: true, error: { message, reset_at } }
          : { type: "turn.failed", error: { message, reset_at } },
      );
    for (const [message, reason] of [
      ["weekly usage limit reached", "quota"],
      ["authentication required: PRIVATE_RAW", "authentication"],
    ] as const) {
      try {
        assertKnowledgeProviderAvailable({
          provider,
          status: "completed",
          stdout: envelope(message),
          stderr: "",
        });
        throw new Error("Expected pause");
      } catch (error) {
        expect(error).toMatchObject({
          code: "knowledge_provider_paused",
          reason,
          resetAt: null,
          observationHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        expect(String(error)).not.toContain("PRIVATE_RAW");
      }
    }
    expect(() =>
      assertKnowledgeProviderAvailable({
        provider,
        status: "completed",
        stdout: envelope("quota exceeded", "2030-01-01T00:00:00Z"),
        stderr: "",
      }),
    ).toThrow(expect.objectContaining({ resetAt: "2030-01-01T00:00:00.000Z" }));
  },
);
it.each(["claude", "codex"] as const)(
  "%s ignores model-authored quota claims in successful content",
  (provider) => {
    expect(() =>
      assertKnowledgeProviderAvailable({
        provider,
        status: "completed",
        stdout: JSON.stringify({
          type: provider === "claude" ? "result" : "item.completed",
          is_error: false,
          result: "quota exceeded, authentication required",
        }),
        stderr: "quota exceeded",
      }),
    ).not.toThrow();
  },
);

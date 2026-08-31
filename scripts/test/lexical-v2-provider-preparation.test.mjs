import { describe, expect, it, vi } from "vitest";

import { prepareLexicalV2ProviderAdapter } from "../natural-language-evaluation/lexical-v2-provider-preparation.mjs";

const uuid = "00000000-0000-4000-8000-000000000001";
const input = {
  repositoryRoot: "/tmp/evidence-only",
  model: "provider-model",
  reasoningEffort: "low",
  structuredOutputSchema: { type: "object" },
};

describe("lexical-v2 provider preparation", () => {
  it("prepares a Codex client outside the adapter request path", async () => {
    const client = {};
    const connectCodex = vi.fn(async () => client);
    const result = await prepareLexicalV2ProviderAdapter(
      { ...input, provider: "codex" },
      {
        connectCodex,
        connectClaude: vi.fn(),
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112),
        uuid: vi.fn(() => uuid),
      },
    );

    expect(connectCodex).toHaveBeenCalledWith({
      executable: "codex",
      cwd: input.repositoryRoot,
      requestTimeoutMs: 30_000,
    });
    expect(result.durationMs).toBe(12);
    expect(result.adapter.descriptor.provider).toBe("codex");
  });

  it("binds a prewarmed Claude client to one generated isolated session", async () => {
    const client = {};
    const connectClaude = vi.fn(async () => client);
    const result = await prepareLexicalV2ProviderAdapter(
      { ...input, provider: "claude" },
      {
        connectCodex: vi.fn(),
        connectClaude,
        now: vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(219),
        uuid: vi.fn(() => uuid),
      },
    );

    expect(connectClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: uuid,
        cwd: input.repositoryRoot,
        model: input.model,
        permissionMode: "plan",
        reasoningEffort: "low",
        tools: [],
        outputFormat: {
          type: "json_schema",
          schema: input.structuredOutputSchema,
        },
      }),
    );
    expect(result.durationMs).toBe(19);
    expect(result.adapter.descriptor.provider).toBe("claude");
  });
});

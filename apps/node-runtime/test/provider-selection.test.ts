import { describe, expect, it } from "vitest";

import { createNodeProviderAdapter } from "../src/managed-provider-runtime.js";

describe("Node conversation provider selection", () => {
  for (const input of [
    { provider: "codex" as const, model: "gpt-5.6-sol" },
    { provider: "claude" as const, model: "claude-sonnet-4-6" },
  ]) {
    it(`records the configured ${input.provider} model in the common adapter descriptor`, () => {
      const adapter = createNodeProviderAdapter({
        ...input,
        repositoryRoot: process.cwd(),
        resolveArtifact: async () => new Uint8Array(),
      });
      expect(adapter.descriptor.provider).toBe(input.provider);
      expect(adapter.resourceAccounting).toMatchObject({
        provider: input.provider,
        requestedModel: input.model,
      });
    });
  }
});

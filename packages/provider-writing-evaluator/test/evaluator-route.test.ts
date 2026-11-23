import { expect, it } from "vitest";

import { createLocalProviderWritingEvaluator } from "../src/index.js";

it("resolves the route once per evaluation and passes it whole to the adapter (ADR-0612)", async () => {
  const created: unknown[] = [];
  let reads = 0;
  const evaluator = createLocalProviderWritingEvaluator({
    provider: () => {
      reads += 1;
      return { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" };
    },
    projectId: "prj_1",
    createAdapter: (input) => {
      created.push({
        provider: input.provider,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      throw new Error("stop after the adapter is created");
    },
    createId: (prefix) => `${prefix}_1`,
    now: () => new Date("2026-11-23T00:00:00.000Z"),
  });
  await expect(
    evaluator.evaluate({
      writingPolicyId: "writing_en-human",
      locale: "en",
      surface: "chat",
      audience: "mixed",
      register: "plain_spec",
      artifactId: `art_${"a".repeat(64)}`,
      contentHash: `sha256:${"a".repeat(64)}`,
      content: "A short reply.",
      checks: [{ checkId: "natural_en_prose", requirement: "Use complete English sentences." }],
    }),
  ).rejects.toThrow("stop after the adapter is created");
  expect(reads).toBe(1);
  expect(created).toEqual([
    { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" },
  ]);
});

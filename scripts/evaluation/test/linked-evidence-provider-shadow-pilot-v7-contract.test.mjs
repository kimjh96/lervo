import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV7ContractDigest,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v7.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("Claude output-framing provider-shadow v7", () => {
  it("binds three fresh repetition-two attempts and one framing event", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV7ContractDigest);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((item) => item.provider === "claude")).toBe(true);
    expect(attempts.every((item) => item.sampleId.startsWith("psv7_"))).toBe(true);
    expect(attempts.every((item) => item.repetition === 2)).toBe(true);
    expect(loaded.contract.provider).toMatchObject({
      maximumStructuredOutputFramingToolsPerInvocation: 1,
      maximumProviderInvocations: 3,
      cumulativeMaximumProviderInvocationsIncludingPredecessors: 60,
    });
  });
});

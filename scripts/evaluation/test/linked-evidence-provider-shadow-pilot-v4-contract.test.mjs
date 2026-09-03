import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV4ContractDigest,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v4.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("linked-evidence paired provider-shadow v4 usage correction", () => {
  it("binds fresh Claude-first pairs to supported usage", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.eligibleCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV4ContractDigest);
    expect(attempts).toHaveLength(48);
    expect(attempts.every((item) => item.sampleId.startsWith("psv4_"))).toBe(true);
    expect(attempts.slice(0, 4).map((item) => item.provider)).toEqual([
      "claude",
      "codex",
      "codex",
      "claude",
    ]);
    expect(loaded.contract.provider).toMatchObject({
      claudeTools: [],
      claudeUsageCapability: "supported",
      cumulativeMaximumProviderInvocationsIncludingPredecessors: 51,
    });
  });
});

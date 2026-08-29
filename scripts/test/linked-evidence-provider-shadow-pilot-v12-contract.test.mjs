import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV12ContractDigest,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  providerShadowClaimCoverageSelectionProtocolDigest,
  providerShadowClaimCoverageSelectionProtocolId,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v12.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("claim-coverage provider-shadow v12 confirmation", () => {
  it("binds four included cases, two exclusions, four repetitions, and 32 attempts", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV12ContractDigest);
    expect(loaded.contract.selectionProtocol).toMatchObject({
      protocolId: providerShadowClaimCoverageSelectionProtocolId,
      protocolDigest: providerShadowClaimCoverageSelectionProtocolDigest,
      output: "provider_native_exact_e4_token_set",
      maximumSelectedSources: 8,
      claimCoverageBeforeMinimizationRequired: true,
    });
    expect(loaded.contract.sourcePopulation.selectedCaseIds).toHaveLength(4);
    expect(loaded.contract.sourcePopulation.excludedCaseIds).toEqual([
      "drv8case_status_node_fleet",
      "drv8case_boundary_user_owned_block",
    ]);
    expect(attempts).toHaveLength(32);
    expect(new Set(attempts.map((item) => item.repetition))).toEqual(new Set([1, 2, 3, 4]));
    expect(attempts.every((item) => item.sampleId.startsWith("psv12_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(16);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(16);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(16);
  });
});

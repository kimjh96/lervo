import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV13ContractDigest,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  providerShadowClaimCoverageSelectionProtocolDigest,
  providerShadowClaimCoverageSelectionProtocolId,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v13.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("diagnostic claim-coverage provider-shadow v13 confirmation", () => {
  it("binds fresh paired attempts and bounded failure diagnostics", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV13ContractDigest);
    expect(loaded.contract.selectionProtocol).toMatchObject({
      protocolId: providerShadowClaimCoverageSelectionProtocolId,
      protocolDigest: providerShadowClaimCoverageSelectionProtocolDigest,
      maximumSelectedSources: 8,
      claimCoverageBeforeMinimizationRequired: true,
    });
    expect(loaded.contract.failureDiagnostics).toMatchObject({
      selectionViolationCodesRequired: true,
      selectionViolationCodeSource: "provider_neutral_parser",
      rawProviderOutputRetained: false,
      priorFailureReclassificationAuthorized: false,
    });
    expect(loaded.contract.predecessor).toMatchObject({
      observedProviderInvocations: 17,
      disposition: "preserve_stopped_rejected",
      resume: false,
      retry: false,
      reuseProviderResults: false,
      borrowCoordinates: false,
    });
    expect(attempts).toHaveLength(32);
    expect(attempts.every((item) => item.sampleId.startsWith("psv13_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(16);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(16);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(16);
  });
});

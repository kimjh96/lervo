import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV14ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import { recoverProviderShadowInvocationCounts } from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-recovery.mjs";
import {
  providerShadowRequestScopedClaimCoverageSelectionProtocolDigest,
  providerShadowRequestScopedClaimCoverageSelectionProtocolId,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v14.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("request-scoped claim-coverage provider-shadow v14", () => {
  it("binds two diagnosed cases, the scoped protocol, and 16 fresh paired attempts", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV14ContractDigest);
    expect(loaded.contract.selectionProtocol).toMatchObject({
      protocolId: providerShadowRequestScopedClaimCoverageSelectionProtocolId,
      protocolDigest: providerShadowRequestScopedClaimCoverageSelectionProtocolDigest,
      output: "provider_native_exact_e4_token_set",
      maximumSelectedSources: 8,
      requestScopeBeforeClaimCoverageRequired: true,
      claimCoverageBeforeMinimizationRequired: true,
    });
    expect(loaded.contract.predecessor).toMatchObject({
      observedProviderInvocations: 32,
      disposition: "preserve_completed_rejected",
      retry: false,
      reuseProviderResults: false,
    });
    expect(loaded.contract.sourcePopulation.selectedCaseIds).toEqual([
      "drv8case_implementation_release",
      "drv8case_boundary_fuzzy_merge",
    ]);
    expect(attempts).toHaveLength(16);
    expect(new Set(attempts.map((item) => item.repetition))).toEqual(new Set([1, 2, 3, 4]));
    expect(attempts.every((item) => item.sampleId.startsWith("psv14_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(8);
  });

  it("accepts bounded v14 unavailable coordinates and counts a persisted invocation once", () => {
    const unavailable = buildProviderShadowV2UnavailableObservation({
      observationId: "psv14obs_recovered_16",
      sampleId: "psv14_codex_drv8case_boundary_fuzzy_merge_r4",
      availabilityStage: "turn_completed",
      missingCoordinates: [],
      failureCode: "provider_shadow_observation_unavailable",
      lastDurableAttemptDigest: `sha256:${"a".repeat(64)}`,
      providerInvocationCount: 1,
      providerSessionId: "provider-session",
      adapterReceiptId: "adapter-receipt",
      providerTurnId: "provider-turn",
    });
    expect(unavailable.record.status).toBe("unavailable");

    const persisted = recoverProviderShadowInvocationCounts(
      {
        providerInvocationCount: 16,
        providerInvocationCounts: { codex: 8, claude: 8 },
        completedObservationCount: 15,
      },
      "codex",
    );
    expect(persisted).toEqual({
      providerInvocationCount: 16,
      providerInvocationCounts: { codex: 8, claude: 8 },
    });

    const notYetPersisted = recoverProviderShadowInvocationCounts(
      {
        providerInvocationCount: 15,
        providerInvocationCounts: { codex: 7, claude: 8 },
        completedObservationCount: 15,
      },
      "codex",
    );
    expect(notYetPersisted).toEqual({
      providerInvocationCount: 16,
      providerInvocationCounts: { codex: 8, claude: 8 },
    });
  });
});

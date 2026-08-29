import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV18ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  providerShadowRelationalCoverageSelectionProtocolDigest,
  providerShadowRelationalCoverageSelectionProtocolId,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v18.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("relational-coverage provider-shadow v18 confirmation", () => {
  it("binds 32 fresh paired attempts across four reviewed cases", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV18ContractDigest);
    expect(loaded.contract.selectionProtocol).toMatchObject({
      protocolId: providerShadowRelationalCoverageSelectionProtocolId,
      protocolDigest: providerShadowRelationalCoverageSelectionProtocolDigest,
      relationSidePreservationRequired: true,
    });
    expect(loaded.contract.predecessor).toMatchObject({
      observedProviderInvocations: 16,
      disposition: "preserve_completed_passed",
      retry: false,
      reuseProviderResults: false,
    });
    expect(attempts).toHaveLength(32);
    expect(attempts.every((item) => item.sampleId.startsWith("psv18_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(16);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(16);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(16);
    expect(new Set(attempts.map((item) => item.caseId)).size).toBe(4);
  });

  it("accepts bounded v18 unavailable coordinates for no-call recovery", () => {
    expect(
      buildProviderShadowV2UnavailableObservation({
        observationId: "psv18obs_recovered_01",
        sampleId: "psv18_codex_drv8case_implementation_release_r1",
        availabilityStage: "turn_completed",
        missingCoordinates: [],
        failureCode: "provider_shadow_observation_unavailable",
        lastDurableAttemptDigest: `sha256:${"a".repeat(64)}`,
        providerInvocationCount: 1,
        providerSessionId: "provider-session",
        adapterReceiptId: "adapter-receipt",
        providerTurnId: "provider-turn",
      }).record.status,
    ).toBe("unavailable");
  });
});

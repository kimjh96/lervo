import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV17ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  providerShadowRelationalCoverageSelectionProtocol,
  providerShadowRelationalCoverageSelectionProtocolDigest,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v17.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("relational-coverage provider-shadow v17", () => {
  it("binds 16 fresh paired attempts to a provider-neutral relation-side rule", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV17ContractDigest);
    expect(loaded.contract.selectionProtocol.protocolDigest).toBe(
      providerShadowRelationalCoverageSelectionProtocolDigest,
    );
    expect(providerShadowRelationalCoverageSelectionProtocol).toContain(
      "each side of that relation as an independently required item",
    );
    expect(providerShadowRelationalCoverageSelectionProtocol).not.toContain("ADR-0180");
    expect(providerShadowRelationalCoverageSelectionProtocol).not.toContain("ADR-0227");
    expect(attempts).toHaveLength(16);
    expect(attempts.every((item) => item.sampleId.startsWith("psv17_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(8);
  });

  it("accepts bounded v17 unavailable coordinates for no-call recovery", () => {
    expect(
      buildProviderShadowV2UnavailableObservation({
        observationId: "psv17obs_recovered_01",
        sampleId: "psv17_codex_drv8case_implementation_release_r1",
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

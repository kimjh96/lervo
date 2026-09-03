import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV16ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  createProviderShadowV2StructuredSelectionSchema,
  loadProviderShadowV2Contract,
} from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v16.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("compatible structured-carrier provider-shadow v16", () => {
  it("binds 16 fresh paired attempts to the schema without uniqueItems", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));
    const schema = createProviderShadowV2StructuredSelectionSchema(
      [
        {
          documentId: "doc_one",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 1,
          classes: [],
        },
      ],
      8,
    );

    expect(digest(bytes)).toBe(authorizedProviderShadowV16ContractDigest);
    expect(loaded.contract.selectionProtocol.output).toBe("structured_exact_e4_token_array");
    expect(schema.properties.evidenceTokens).not.toHaveProperty("uniqueItems");
    expect(loaded.contract.predecessor).toMatchObject({
      observedProviderInvocations: 1,
      disposition: "preserve_completed_rejected",
      retry: false,
      reuseProviderResults: false,
    });
    expect(attempts).toHaveLength(16);
    expect(attempts.every((item) => item.sampleId.startsWith("psv16_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(8);
  });

  it("accepts bounded v16 unavailable coordinates for no-call recovery", () => {
    expect(
      buildProviderShadowV2UnavailableObservation({
        observationId: "psv16obs_recovered_01",
        sampleId: "psv16_codex_drv8case_implementation_release_r1",
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

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV5ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  createProviderShadowV2StructuredSelectionSchema,
  loadProviderShadowV2Contract,
  parseProviderShadowV2StructuredSelection,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v5.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("Claude structured-selection provider-shadow v5", () => {
  it("binds three fresh Claude-only attempts to exact contract bytes", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV5ContractDigest);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((item) => item.provider === "claude")).toBe(true);
    expect(attempts.every((item) => item.sampleId.startsWith("psv5_"))).toBe(true);
    expect(new Set(attempts.map((item) => item.caseId)).size).toBe(3);
    expect(loaded.contract.provider).toMatchObject({
      claudeTools: [],
      claudeUsageCapability: "supported",
      claudeStructuredOutput: "json_schema",
      maximumProviderInvocations: 3,
      cumulativeMaximumProviderInvocationsIncludingPredecessors: 54,
    });
  });

  it("accepts only the exact structured E4 token array", () => {
    const candidate = {
      documentId: "doc_one",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteCount: 123,
      classes: ["recommendation"],
    };
    const token = `lervo-e4:${candidate.documentId}:${candidate.contentHash}`;
    const schema = createProviderShadowV2StructuredSelectionSchema([candidate], 8);

    expect(schema).toMatchObject({
      properties: {
        evidenceTokens: { items: { enum: [token] }, maxItems: 8 },
      },
      required: ["evidenceTokens"],
      additionalProperties: false,
    });
    expect(schema.properties.evidenceTokens).not.toHaveProperty("uniqueItems");
    expect(
      parseProviderShadowV2StructuredSelection(
        JSON.stringify({ evidenceTokens: [token] }),
        [candidate],
        8,
      ),
    ).toMatchObject({
      passed: true,
      selected: [{ documentId: candidate.documentId, contentHash: candidate.contentHash }],
    });
    expect(
      parseProviderShadowV2StructuredSelection(
        JSON.stringify({ evidenceTokens: [token], prose: "extra" }),
        [candidate],
        8,
      ),
    ).toMatchObject({ passed: false, violations: ["invalid_structured_selection_shape"] });
    expect(
      parseProviderShadowV2StructuredSelection(
        JSON.stringify({ evidenceTokens: [token, token] }),
        [candidate],
        8,
      ),
    ).toMatchObject({ passed: false, violations: ["duplicate_e4_marker"] });
  });

  it("accepts bounded v5 unavailable coordinates for no-call recovery", () => {
    expect(
      buildProviderShadowV2UnavailableObservation({
        observationId: "psv5obs_recovered_01",
        sampleId: "psv5_claude_case_one_r1",
        availabilityStage: "turn_completed",
        missingCoordinates: [],
        failureCode: "provider_shadow_observation_unavailable",
        lastDurableAttemptDigest: `sha256:${"b".repeat(64)}`,
        providerInvocationCount: 1,
      }).record,
    ).toMatchObject({ status: "unavailable", providerInvocationCount: 1 });
  });
});

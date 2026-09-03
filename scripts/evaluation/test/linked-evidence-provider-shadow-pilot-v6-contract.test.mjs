import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV6ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v6.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("durable Claude structured-selection provider-shadow v6", () => {
  it("binds three fresh Claude-only attempts and durable failure evidence", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV6ContractDigest);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((item) => item.provider === "claude")).toBe(true);
    expect(attempts.every((item) => item.sampleId.startsWith("psv6_"))).toBe(true);
    expect(loaded.contract.attemptJournal).toMatchObject({
      persistOutcomeBeforeObservationBuild: true,
    });
    expect(loaded.contract.provider).toMatchObject({
      durableFailureCodeRequired: true,
      maximumProviderInvocations: 3,
      cumulativeMaximumProviderInvocationsIncludingPredecessors: 57,
    });
  });

  it("accepts bounded v6 unavailable coordinates", () => {
    expect(
      buildProviderShadowV2UnavailableObservation({
        observationId: "psv6obs_recovered_01",
        sampleId: "psv6_claude_case_one_r1",
        availabilityStage: "turn_completed",
        missingCoordinates: [],
        failureCode: "provider_shadow_observation_unavailable",
        lastDurableAttemptDigest: `sha256:${"b".repeat(64)}`,
        providerInvocationCount: 1,
      }).record,
    ).toMatchObject({ status: "unavailable", providerInvocationCount: 1 });
  });
});

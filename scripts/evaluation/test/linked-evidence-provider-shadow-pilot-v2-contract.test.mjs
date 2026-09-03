import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV2ContractDigest,
  buildProviderShadowV2UnavailableObservation,
  canonicalizeProviderShadowV2Candidate,
  createProviderShadowV2AttemptSchedule,
  createProviderShadowV2Schedule,
  loadProviderShadowV2Contract,
  parseProviderShadowV2Selection,
  providerShadowV2ExecutionDisposition,
  providerShadowSelectionViolationCodes,
  validateProviderShadowSelectionViolationCodes,
  validateProviderShadowV2Candidate,
} from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import { linkedEvidenceReconciliationV8SelectionProtocolDigest } from "../../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = new URL(
  "benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json",
  repositoryRoot,
);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function emptyStateCounts(overrides = {}) {
  return {
    attempt: 0,
    execution: 0,
    failure: 0,
    review: 0,
    observation: 0,
    recovery: 0,
    ...overrides,
  };
}

describe("linked-evidence paired provider-shadow v2 contract", () => {
  it("binds exact authorized bytes and paired fresh provider attempts", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname);
    const schedule = createProviderShadowV2Schedule(loaded.contract, loaded.eligibleCases);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.eligibleCases);
    const packageJson = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));

    expect(digest(await readFile(contractPath))).toBe(authorizedProviderShadowV2ContractDigest);
    expect(loaded.contract.authorization).toMatchObject({
      status: "authorized_exact_paired_execution",
      providerCallsAuthorized: true,
      maximumProviderInvocationsAuthorized: 48,
      managedContextEffectsAuthorized: false,
      canaryAuthorized: false,
      productionActivationAuthorized: false,
    });
    expect(loaded.contract.predecessor).toMatchObject({
      disposition: "preserve_stopped_rejected",
      resume: false,
      retry: false,
      reuseProviderResults: false,
      borrowCoordinates: false,
    });
    expect(loaded.contract.selectionProtocol.protocolDigest).toBe(
      linkedEvidenceReconciliationV8SelectionProtocolDigest,
    );
    expect(schedule).toHaveLength(24);
    expect(new Set(schedule.map((item) => item.sampleId)).size).toBe(24);
    expect(schedule.every((item) => item.sampleId.startsWith("psv2_"))).toBe(true);
    expect(attempts).toHaveLength(48);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(24);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(24);
    expect(attempts.slice(0, 4).map((item) => item.provider)).toEqual([
      "codex",
      "claude",
      "claude",
      "codex",
    ]);
    expect(new Set(attempts.map((item) => item.shadowRunId)).size).toBe(48);
    expect(loaded.contract.provider.maximumProviderInvocations).toBe(48);
    expect(loaded.contract.provider.maximumProviderInvocationsPerArm).toBe(24);
    expect(loaded.contract.provider.maximumRetries).toBe(0);
    expect(loaded.contract.attemptJournal).toMatchObject({
      recordKind: "linked_evidence_provider_shadow_attempt.v2",
      persistAfterEveryAdapterBoundary: true,
      postTurnOutcome: "typed_observed_or_unavailable_union",
      throwBeforePostTurnPersistence: false,
      recoveryMayCallProvider: false,
    });
    expect(loaded.contract.recovery).toMatchObject({
      acceptedTurnRequiresObservationBeforeNextCallOrReview: true,
      materializeUnavailableFromAttemptJournal: true,
      mayResumeExecution: false,
      mayRetryProvider: false,
      mayReplaceSample: false,
      mayBorrowV1ResultOrCoordinates: false,
    });
    expect(loaded.contract.observation).toMatchObject({
      maximumPilots: 2,
      maximumActivePilots: 1,
      maximumObservations: 48,
    });
    expect(loaded.contract.noEffect).toEqual({
      operationalSearchSelection: "unchanged",
      primaryManagedContext: "unchanged",
      primaryOutput: "unchanged",
      managedWrites: "unchanged",
      verification: "unchanged",
      semanticPublication: "unchanged",
      e1ThroughE4Events: "unchanged",
      directTerminals: "unchanged",
      canaryTraffic: "none",
      productionActivation: "none",
    });
    expect(Object.values(packageJson.scripts)).toContain(
      "node scripts/evaluation/run-linked-evidence-provider-shadow-pilot-v2.mjs",
    );
  });

  it("uses one documentId-only candidate shape after preparation", () => {
    const registeredSource = {
      sourceId: "doc_one",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteCount: 123,
      classes: ["recommendation", "linked"],
      path: "docs/private-to-the-boundary.md",
      text: "untrusted source body",
    };
    const candidate = canonicalizeProviderShadowV2Candidate(registeredSource);
    expect(candidate).toEqual({
      documentId: "doc_one",
      contentHash: registeredSource.contentHash,
      byteCount: 123,
      classes: ["recommendation", "linked"],
    });
    expect(candidate).not.toHaveProperty("sourceId");
    expect(candidate).not.toHaveProperty("path");
    expect(candidate).not.toHaveProperty("text");

    const rawContent = `<!-- lervo-e4:${candidate.documentId}:${candidate.contentHash} -->`;
    expect(parseProviderShadowV2Selection(rawContent, [candidate], 8)).toMatchObject({
      passed: true,
      selected: [{ documentId: candidate.documentId, contentHash: candidate.contentHash }],
    });
    expect(() =>
      validateProviderShadowV2Candidate({ ...candidate, sourceId: candidate.documentId }),
    ).toThrow("only the canonical fields");
  });

  it("rejects every persisted state as non-resumable", () => {
    expect(providerShadowV2ExecutionDisposition(emptyStateCounts())).toEqual({
      status: "fresh",
      executionAuthorized: false,
      maySeekExecutionAuthority: true,
      persistedKinds: [],
    });
    for (const kind of ["attempt", "execution", "failure", "review", "observation", "recovery"]) {
      expect(providerShadowV2ExecutionDisposition(emptyStateCounts({ [kind]: 1 }))).toEqual({
        status: "non_resumable",
        executionAuthorized: false,
        maySeekExecutionAuthority: false,
        persistedKinds: [kind],
      });
    }
  });

  it("materializes a bounded unavailable record from durable post-turn state", () => {
    const unavailable = buildProviderShadowV2UnavailableObservation({
      observationId: "psv2obs_one",
      sampleId: "psv2_case_one_r1",
      availabilityStage: "turn_completed",
      missingCoordinates: ["adapterReceiptId", "providerTurnId", "adapterReceiptId"],
      failureCode: "provider_shadow_observation_unavailable",
      lastDurableAttemptDigest: `sha256:${"b".repeat(64)}`,
      providerInvocationCount: 1,
      providerSessionId: "provider-session-one",
    });

    expect(unavailable.record).toEqual({
      recordKind: "linked_evidence_provider_shadow_observation.v2",
      observationId: "psv2obs_one",
      sampleId: "psv2_case_one_r1",
      status: "unavailable",
      availabilityStage: "turn_completed",
      missingCoordinates: ["adapterReceiptId", "providerTurnId"],
      failureCode: "provider_shadow_observation_unavailable",
      lastDurableAttemptDigest: `sha256:${"b".repeat(64)}`,
      providerInvocationCount: 1,
      providerSessionId: "provider-session-one",
      adapterReceiptId: null,
      providerTurnId: null,
    });
    expect(unavailable.recordDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(unavailable.record).not.toHaveProperty("result");
    expect(unavailable.record).not.toHaveProperty("query");
    expect(unavailable.record).not.toHaveProperty("error");
    expect(() =>
      buildProviderShadowV2UnavailableObservation({
        ...unavailable.record,
        missingCoordinates: ["rawProviderResult"],
      }),
    ).toThrow("bounded names");
  });

  it("bounds selection violation diagnostics to parser-owned codes", () => {
    expect(
      validateProviderShadowSelectionViolationCodes([
        "unknown_e4_marker",
        "provider_shadow_prose_present",
        "unknown_e4_marker",
      ]),
    ).toEqual(["provider_shadow_prose_present", "unknown_e4_marker"]);
    expect(providerShadowSelectionViolationCodes).toHaveLength(7);
    expect(() => validateProviderShadowSelectionViolationCodes(["raw_provider_output"])).toThrow(
      "invalid",
    );
  });
});

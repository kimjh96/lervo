import { describe, expect, it } from "vitest";

import {
  createPhaseAPilotSchedule,
  loadPhaseAPilotContract,
  stableJson,
  valueDigest,
} from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { assessPhaseAPilotOutcome } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-eligibility.mjs";
import { samePhaseAPilotProjection } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-review.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("linked-evidence phase-A pilot contract", () => {
  it("binds the reviewed 30-run schedule without changing public queries", async () => {
    const { contract, suite } = await loadPhaseAPilotContract(repositoryRoot);
    const schedule = createPhaseAPilotSchedule(contract, suite);
    expect(schedule).toHaveLength(30);
    expect(new Set(schedule.map((run) => run.targetPath)).size).toBe(30);
    expect(new Set(schedule.map((run) => run.verificationSuiteId)).size).toBe(30);
    expect(schedule.every((run) => suite.cases.some((item) => item.query === run.query))).toBe(
      true,
    );
    expect(schedule.filter((run) => run.repetition === 4)).toHaveLength(6);
  });

  it("binds the replacement two-pass budget and search-specific eligibility", async () => {
    const { contract, suite } = await loadPhaseAPilotContract(
      repositoryRoot,
      "benchmarks/search/linked-evidence-shadow-phase-a-pilot-v2.json",
    );
    expect(createPhaseAPilotSchedule(contract, suite)).toHaveLength(30);
    expect(contract.managedRun.maximumProviderInvocations).toBe(60);
    const runSpec = { targetPath: "pilot-output-01.md" };
    const outcome = {
      verificationStatus: "passed",
      managedChanges: [{ path: runSpec.targetPath }],
      writingPublication: {
        status: "blocked",
        semanticEvaluationStatus: "completed",
      },
    };
    expect(
      assessPhaseAPilotOutcome({
        contract,
        runSpec,
        exitStatus: 1,
        outcome,
        runCompleted: true,
      }),
    ).toEqual({ eligible: true, reason: null, providerInvocationCount: 2 });
    expect(
      assessPhaseAPilotOutcome({
        contract,
        runSpec,
        exitStatus: 1,
        outcome,
        runCompleted: false,
      }).eligible,
    ).toBe(false);
  });

  it("binds the corrected-target v3 budget without deleting stopped predecessors", async () => {
    const { contract, suite } = await loadPhaseAPilotContract(
      repositoryRoot,
      "benchmarks/search/linked-evidence-shadow-phase-a-pilot-v3.json",
    );
    expect(contract.decisionId).toBe("ADR-0252");
    expect(contract.retention).toEqual({
      root: ".lervo/state/search/linked-evidence-shadow-pilots",
      classification: "deletable_derived_state",
      maximumPilots: 3,
      maximumActivePilots: 1,
    });
    expect(contract.managedRun.maximumProviderInvocations).toBe(60);
    expect(createPhaseAPilotSchedule(contract, suite)).toHaveLength(30);
  });

  it("uses order-independent object hashing while preserving array order", () => {
    expect(stableJson({ second: 2, first: ["a", "b"] })).toBe(
      stableJson({ first: ["a", "b"], second: 2 }),
    );
    expect(valueDigest({ values: [1, 2] })).not.toBe(valueDigest({ values: [2, 1] }));
  });

  it("replays retained coordinates independent of object key serialization order", () => {
    const common = {
      recommendationCount: 1,
      candidateCount: 1,
      retainedCount: 1,
      ignoredCount: 0,
      truncated: false,
      retainedByteCount: 10,
      projectionDigest: `sha256:${"a".repeat(64)}`,
      sourceSnapshotId: `sha256:${"b".repeat(64)}`,
    };
    expect(
      samePhaseAPilotProjection(
        {
          ...common,
          retained: [{ contentHash: `sha256:${"c".repeat(64)}`, documentId: "doc_example" }],
        },
        {
          ...common,
          retained: [{ documentId: "doc_example", contentHash: `sha256:${"c".repeat(64)}` }],
        },
      ),
    ).toBe(true);
  });
});

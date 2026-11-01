import { normalizeGovernedLoopPolicy } from "@lervo/application-contract";
import { eventTypes, type EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  assignmentTopologyDigest,
  completionEvidenceId,
  governedWorkReportEventTypes,
  managedAttemptEventTypes,
  projectGovernedWorkReport,
  projectManagedAttempts,
  projectWorkGraphV2,
  workGraphV2EventTypes,
} from "../src/index.js";
import { assignment, causalityPayload, event, projectId, workstreamId } from "./fixtures.js";

const node = assignment("1");
const rootRun = "run_111111111111111111111111";
const retryRun = "run_222222222222222222222222";
const workId = "wrk_111111111111111111111111";
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const resultArtifactId = `art_${"a".repeat(64)}`;
const preparedAt = "2026-09-01T00:00:09.000Z";
const modelIdentity = {
  provider: "codex",
  requestedModel: null,
  answerModel: "codex-fixture",
  observedModelIds: ["codex-fixture"],
  answerModelEvidence: "thread_start",
  unavailableReason: null,
} as const;

function usage(
  sequence: number,
  runId: string,
  observationId: string,
  sourceDigit: string,
): EventEnvelope {
  return event(
    sequence,
    "resource.usage.recorded",
    runId,
    {
      workId,
      resourceObservationId: observationId,
      sourceCoordinateDigest: hash(sourceDigit),
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: hash("a"),
      modelIdentity,
      status: "observed",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
        reasoningOutputTokens: 1,
        totalTokens: 14,
        contextWindow: 200000,
      },
      reasonCode: null,
    },
    "codex",
  );
}

function topologyNode(sequence: number, nodeKey: string): EventEnvelope {
  return {
    ...event(sequence, "assignment.created", `run_${String(sequence).padStart(24, "0")}`, {
      assignmentId: `asn_${String(sequence).padStart(24, "0")}`,
      workstreamId,
      topologyContractVersion: 2,
      topologyChangeId: "gtc_111111111111111111111111",
      topologyChangeKey: "parallel_review",
      topologyPlanId: "gtp_222222222222222222222222",
      topologyApprovalHash: hash("b"),
      topologyReviewerIdDigest: hash("c"),
      topologyRequestHash: hash("d"),
      topologyExpectedNodeCount: 2,
      topologyNodeSetHash: assignmentTopologyDigest(["left", "right"]),
      topologyNodeKey: nodeKey,
    }),
  };
}

/** One history that exercises every event type the governed projections declare. */
function consumedHistory(): EventEnvelope[] {
  const coordinate = {
    workstreamId,
    assignmentId: node.assignmentId,
    assignmentRevision: 2,
    agentId: "agt_111111111111111111111111",
    leaseId: "lse_111111111111111111111111",
    runId: retryRun,
    sessionId: event(1, "run.completed", retryRun, {}).sessionId,
    resultArtifactId,
    resultContentHash: hash("e"),
    preparedAt,
  };
  const stages = {
    ...event(8, "execution.stages.observed", retryRun, {
      executionMode: "managed",
      workId,
      terminalObservationId: null,
      terminalHook: null,
      observationSetId: "stgobs_111111111111111111111111",
      stageCatalogVersion: 2,
      environmentProfileDigest: hash("f"),
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 90,
          budgetMs: null,
          outcome: "completed",
          coldState: "warm",
        },
      ],
    }),
    schemaVersion: 2 as const,
  };
  return [
    event(
      1,
      "work.causality.recorded",
      rootRun,
      causalityPayload({ assignmentId: node.assignmentId }),
    ),
    event(2, "adapter.started", rootRun, {}, "codex"),
    event(3, "provider.process.observed", rootRun, {}, "codex"),
    event(4, "run.failed", rootRun, {}),
    usage(5, rootRun, "ruo_111111111111111111111111", "1"),
    event(
      6,
      "work.causality.recorded",
      retryRun,
      causalityPayload({
        assignmentId: node.assignmentId,
        workId,
        relationship: "retry",
        parentRunId: rootRun,
        retryOfRunId: rootRun,
        attemptOrdinal: 2,
      }),
    ),
    event(7, "adapter.started", retryRun, {}, "codex"),
    stages,
    event(9, "run.completed", retryRun, {
      resultDigest: coordinate.resultContentHash,
      artifactIds: [resultArtifactId],
      verificationStatus: "passed",
    }),
    usage(10, retryRun, "ruo_222222222222222222222222", "2"),
    event(11, "adapter.stopped", retryRun, {}, "codex"),
    {
      ...event(12, "assignment.completion.prepared", retryRun, {
        completionEvidenceId: completionEvidenceId(coordinate),
        workstreamId,
        assignmentId: node.assignmentId,
        assignmentRevision: 2,
        agentId: coordinate.agentId,
        leaseId: coordinate.leaseId,
        resultArtifactId,
        resultContentHash: coordinate.resultContentHash,
        verificationStatus: "passed",
        writingPublicationStatus: "allowed",
        preparedAt,
      }),
      occurredAt: preparedAt,
    },
    topologyNode(13, "left"),
    topologyNode(14, "right"),
  ];
}

/**
 * Adds one event of every catalog type outside `declared`, bound to the governed runs with a
 * contradictory provider and payload. A projection that consumed any of them would change or fail.
 */
function withUndeclaredNoise(
  history: readonly EventEnvelope[],
  declared: readonly string[],
): EventEnvelope[] {
  const noise = eventTypes
    .filter((type) => !declared.includes(type))
    .flatMap((type, index) =>
      [rootRun, retryRun].map((runId, runIndex) =>
        event(
          100 + index * 2 + runIndex,
          type,
          runId,
          {
            workId: "wrk_999999999999999999999999",
            workstreamId,
            assignmentId: node.assignmentId,
            verificationStatus: "failed",
            resultDigest: hash("9"),
            artifactIds: [],
          },
          "claude",
        ),
      ),
    );
  return [...history, ...noise];
}

const query = {
  schemaVersion: 1 as const,
  kind: "governed_work.inspect" as const,
  projectId,
  workstreamId,
  observedAt: "2026-09-01T01:00:00.000Z",
  policy: normalizeGovernedLoopPolicy(),
};

describe("projection event-type declarations", () => {
  it("lets a typed read of the declared governed-work types replace the whole history", () => {
    const history = consumedHistory();
    const expected = projectGovernedWorkReport({ query, assignments: [node], events: history });
    expect(expected.attempts.map((attempt) => attempt.terminalStatus)).toEqual([
      "failed",
      "completed",
    ]);
    expect(expected.completionEvidence).toHaveLength(1);
    expect(expected.stages).toHaveLength(1);

    const whole = withUndeclaredNoise(history, governedWorkReportEventTypes);
    const typed = whole.filter((item) => governedWorkReportEventTypes.includes(item.type));
    expect(projectGovernedWorkReport({ query, assignments: [node], events: whole })).toEqual(
      expected,
    );
    expect(projectGovernedWorkReport({ query, assignments: [node], events: typed })).toEqual(
      expected,
    );
  });

  it("keeps pre-start resource receipts and their fail-closed evidence under a typed read", () => {
    const unavailable = {
      ...usage(2, rootRun, "ruo_333333333333333333333333", "3"),
    };
    unavailable.payload = {
      ...unavailable.payload,
      status: "unavailable",
      usage: null,
      reasonCode: "resource_observation_missing",
    };
    const preStart = [
      event(
        1,
        "work.causality.recorded",
        rootRun,
        causalityPayload({ assignmentId: node.assignmentId }),
      ),
      unavailable,
      event(4, "run.failed", rootRun, {
        failureCode: "provider_start_failed",
        retryable: false,
      }),
    ];
    const typedAttempts = (events: readonly EventEnvelope[]) =>
      projectManagedAttempts({
        events: withUndeclaredNoise(events, managedAttemptEventTypes).filter((item) =>
          managedAttemptEventTypes.includes(item.type),
        ),
        workstreamId,
      });
    expect(typedAttempts(preStart)).toEqual(
      projectManagedAttempts({ events: preStart, workstreamId }),
    );
    expect(typedAttempts(preStart).resources).toMatchObject([{ completeness: "unavailable" }]);

    for (const receipt of ["provider.process.observed", "adapter.stopped"]) {
      const started = [...preStart, event(3, receipt, rootRun, {}, "codex")].sort(
        (left, right) => left.seq - right.seq,
      );
      expect(() => projectManagedAttempts({ events: started, workstreamId })).toThrowError(
        "differs from its run provider",
      );
      expect(() => typedAttempts(started)).toThrowError("differs from its run provider");
    }
  });

  it("lets a typed read of the declared attempt and topology types replace the whole history", () => {
    const declared = [...new Set([...managedAttemptEventTypes, ...workGraphV2EventTypes])];
    const project = (events: readonly EventEnvelope[]) => {
      const attempts = projectManagedAttempts({ events, workstreamId });
      return {
        attempts,
        graph: projectWorkGraphV2({
          projectId,
          workstreamId,
          assignments: [node],
          attempts: attempts.attempts,
          events,
          observedAt: query.observedAt,
        }),
      };
    };
    const history = consumedHistory();
    const expected = project(history);
    expect(expected.graph.topologyHistory.status).toBe("valid");

    const whole = withUndeclaredNoise(history, declared);
    expect(project(whole)).toEqual(expected);
    expect(project(whole.filter((item) => declared.includes(item.type)))).toEqual(expected);
  });
});

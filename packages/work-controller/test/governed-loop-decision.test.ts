import { describe, expect, it } from "vitest";

import { normalizeGovernedLoopPolicy } from "@lervo/application-contract";

import { decideGovernedLoop, projectWorkGraph } from "../src/index.js";
import { assignment, projectId, workstreamId } from "./fixtures.js";

const observedAt = "2026-09-01T00:01:00.000Z";
const agentId = "agt_111111111111111111111111";

function leased(suffix: string, dependencies: string[] = []) {
  return assignment(suffix, {
    status: "leased",
    dependencyIds: dependencies,
    assigneeAgentId: agentId,
    lease: {
      leaseId: `lse_${suffix.repeat(24).slice(0, 24)}`,
      agentId,
      sessionId: `ses_${suffix.repeat(24).slice(0, 24)}`,
      generation: 1,
      acquiredAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:05:00.000Z",
    },
  });
}

describe("governed loop decision", () => {
  it("admits two parallel attempts and holds their join", () => {
    const left = leased("1");
    const right = leased("2");
    const join = assignment("3", { dependencyIds: [left.assignmentId, right.assignmentId] });
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [left, right, join],
      attempts: [],
      observedAt,
    });
    const decision = decideGovernedLoop({
      graph,
      attempts: [],
      resources: [],
      policy: normalizeGovernedLoopPolicy(),
    });
    expect(decision.actions.map((action) => action.kind)).toEqual([
      "start_attempt",
      "start_attempt",
    ]);
  });

  it("counts active attempts against the parallel-assignment bound", () => {
    const active = leased("1");
    const waiting = leased("2");
    const attempts = [
      {
        schemaVersion: 1 as const,
        assignmentId: active.assignmentId,
        workId: "wrk_111111111111111111111111",
        runId: "run_111111111111111111111111",
        relationship: "root" as const,
        attemptOrdinal: 1,
        terminalStatus: "in_progress" as const,
        verificationStatus: "unavailable" as const,
      },
    ];
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [active, waiting],
      attempts,
      observedAt,
    });
    const decision = decideGovernedLoop({
      graph,
      attempts,
      resources: [],
      policy: normalizeGovernedLoopPolicy({ maxParallelAssignments: 1 }),
    });

    expect(decision.actions).toEqual([
      { kind: "wait", assignmentId: active.assignmentId, reasonCode: "active_attempt" },
    ]);
  });

  it("produces exact retry ancestry after one failed attempt", () => {
    const node = leased("1");
    const attempts = [
      {
        schemaVersion: 1 as const,
        assignmentId: node.assignmentId,
        workId: "wrk_111111111111111111111111",
        runId: "run_111111111111111111111111",
        relationship: "root" as const,
        attemptOrdinal: 1,
        terminalStatus: "failed" as const,
        verificationStatus: "unavailable" as const,
      },
    ];
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [node],
      attempts,
      observedAt,
    });
    const decision = decideGovernedLoop({
      graph,
      attempts,
      resources: [],
      policy: normalizeGovernedLoopPolicy(),
    });
    expect(decision.actions[0]).toMatchObject({
      kind: "retry_attempt",
      causality: { attemptOrdinal: 2, retryOfRunId: attempts[0]!.runId },
    });
  });

  it("fails closed for approval and incomplete resource evidence", () => {
    const approvalNode = leased("1");
    approvalNode.approvalRequirements = ["human-review"];
    const approvalGraph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [approvalNode],
      attempts: [],
      observedAt,
    });
    expect(
      decideGovernedLoop({
        graph: approvalGraph,
        attempts: [],
        resources: [],
        policy: normalizeGovernedLoopPolicy(),
      }).actions[0],
    ).toMatchObject({ kind: "await_approval", reasonCode: "approval_missing" });

    const descriptor = `sha256:${"a".repeat(64)}`;
    const resourceDecision = decideGovernedLoop({
      graph: projectWorkGraph({
        projectId,
        workstreamId,
        assignments: [leased("2")],
        attempts: [],
        observedAt,
      }),
      attempts: [],
      resources: [
        {
          schemaVersion: 1,
          provider: "codex",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: descriptor,
          completeness: "partial",
          totalTokens: 50,
          runCount: 1,
          reasonCodes: ["counter_incomplete"],
        },
      ],
      policy: normalizeGovernedLoopPolicy({
        tokenLimits: [
          {
            provider: "codex",
            accountingDescriptorHash: descriptor,
            stopAfterObservedTotalTokens: 100,
          },
        ],
      }),
    });
    expect(resourceDecision).toMatchObject({
      status: "escalation_required",
      actions: [{ kind: "escalate", reasonCode: "resource_unobservable" }],
    });
  });

  it("propagates cancellation to a non-terminal dependent", () => {
    const cancelled = assignment("1", { status: "cancelled" });
    const dependent = assignment("2", { dependencyIds: [cancelled.assignmentId] });
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [cancelled, dependent],
      attempts: [],
      observedAt,
    });
    expect(
      decideGovernedLoop({
        graph,
        attempts: [],
        resources: [],
        policy: normalizeGovernedLoopPolicy(),
      }).actions,
    ).toEqual([
      {
        kind: "cancel_assignment",
        assignmentId: dependent.assignmentId,
        reasonCode: "dependency_cancelled",
      },
    ]);
  });

  it("blocks another attempt after an exact observed threshold is reached", () => {
    const descriptor = `sha256:${"d".repeat(64)}`;
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [leased("4")],
      attempts: [],
      observedAt,
    });
    const decision = decideGovernedLoop({
      graph,
      attempts: [],
      resources: [
        {
          schemaVersion: 1,
          provider: "codex",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: descriptor,
          completeness: "complete",
          totalTokens: 100,
          runCount: 1,
          reasonCodes: [],
        },
      ],
      policy: normalizeGovernedLoopPolicy({
        tokenLimits: [
          {
            provider: "codex",
            accountingDescriptorHash: descriptor,
            stopAfterObservedTotalTokens: 100,
          },
        ],
      }),
    });
    expect(decision).toMatchObject({
      status: "blocked",
      actions: [{ kind: "block", reasonCode: "resource_exhausted" }],
    });
  });
});

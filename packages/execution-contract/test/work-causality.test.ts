import { describe, expect, it } from "vitest";

import type { EventEnvelope, WorkCausalityRecordedEventPayload } from "@lervo/schemas";

import {
  projectRunCausality,
  validateWorkCausalityAdmission,
  validateWorkCausalityHistory,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const workId = `wrk_${"b".repeat(24)}`;

function causality(
  runId: string,
  payload: Partial<WorkCausalityRecordedEventPayload> = {},
): EventEnvelope {
  const root = payload.relationship === undefined || payload.relationship === "root";
  return {
    eventId: `evt_${runId.slice(4)}_causality`,
    projectId: "prj_causality_fixture",
    runId,
    sessionId: `ses_${runId.slice(4)}_fixture`,
    seq: 1,
    type: "work.causality.recorded",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion: hash,
    payload: {
      workId,
      executionContractVersion: 1,
      relationship: root ? "root" : "subagent",
      parentRunId: root ? null : "run_root_fixture",
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
      ...payload,
    },
    previousHash: null,
    eventHash: hash,
  } as EventEnvelope;
}

function requested(runId: string, schemaVersion: 1 | 2 = 2): EventEnvelope {
  return {
    ...causality(runId),
    eventId: `evt_${runId.slice(4)}_requested`,
    type: "run.requested",
    schemaVersion,
    payload: { requestDigest: hash, role: "developer", risk: "low" },
  } as EventEnvelope;
}

describe("work causality contract", () => {
  it("accepts one root and provider-neutral child relationships in the same work", () => {
    const root = causality("run_root_fixture");
    const child = causality("run_child_fixture", {
      relationship: "subagent",
      parentRunId: root.runId,
    });
    expect(validateWorkCausalityHistory([root, child]).get(child.runId)?.payload.workId).toBe(
      workId,
    );
  });

  it.each([
    "repair",
    "subagent",
    "verification",
    "publication_evaluation",
    "deliberation",
    "improvement_evaluation",
  ] as const)("accepts the %s child relationship through the same invariant", (relationship) => {
    const root = causality("run_root_fixture");
    const child = causality(`run_${relationship}_fixture`, {
      relationship,
      parentRunId: root.runId,
    });
    expect(() => validateWorkCausalityHistory([root, child])).not.toThrow();
  });

  it("accepts a retry only at the next logical attempt in the same work", () => {
    const root = causality("run_root_fixture");
    const retry = causality("run_retry_fixture", {
      relationship: "retry",
      parentRunId: root.runId,
      retryOfRunId: root.runId,
      attemptOrdinal: 2,
    });
    expect(validateWorkCausalityHistory([root, retry]).get(retry.runId)?.payload).toMatchObject({
      relationship: "retry",
      retryOfRunId: root.runId,
      attemptOrdinal: 2,
    });
  });

  it("rejects missing parents, work-tree escape, duplicate roots, invalid retry, and cycles", () => {
    const root = causality("run_root_fixture");
    expect(() =>
      validateWorkCausalityHistory([
        causality("run_child_fixture", {
          relationship: "subagent",
          parentRunId: "run_absent_parent",
        }),
      ]),
    ).toThrow(/no recorded causal parent/u);
    expect(() =>
      validateWorkCausalityHistory([
        root,
        causality("run_child_fixture", {
          workId: `wrk_${"c".repeat(24)}`,
          relationship: "subagent",
          parentRunId: root.runId,
        }),
      ]),
    ).toThrow(/escapes/u);
    expect(() => validateWorkCausalityHistory([root, causality("run_other_fixture")])).toThrow(
      /more than one causal root/u,
    );
    expect(() =>
      validateWorkCausalityHistory([
        root,
        causality("run_retry_fixture", {
          relationship: "retry",
          parentRunId: root.runId,
          retryOfRunId: root.runId,
          attemptOrdinal: 3,
        }),
      ]),
    ).toThrow(/invalid retry ancestry/u);
    expect(() =>
      validateWorkCausalityHistory([
        causality("run_cycle_a_fixture", {
          relationship: "subagent",
          parentRunId: "run_cycle_b_fixture",
        }),
        causality("run_cycle_b_fixture", {
          relationship: "subagent",
          parentRunId: "run_cycle_a_fixture",
        }),
      ]),
    ).toThrow(/cyclic work tree/u);
  });

  it("allows exact crash recovery but rejects replay after run admission", () => {
    const root = causality("run_root_fixture");
    expect(
      validateWorkCausalityAdmission({
        events: [root],
        runId: root.runId,
        eventId: root.eventId,
        payload: root.payload as WorkCausalityRecordedEventPayload,
      }),
    ).toBe("idempotent");
    expect(() =>
      validateWorkCausalityAdmission({
        events: [root, requested(root.runId)],
        runId: root.runId,
        eventId: root.eventId,
        payload: root.payload as WorkCausalityRecordedEventPayload,
      }),
    ).toThrow(/already been admitted/u);
  });

  it("projects historical requested runs without invented ancestry", () => {
    const root = causality("run_root_fixture");
    expect(
      projectRunCausality([requested("run_legacy_fixture", 1), root, requested(root.runId)]),
    ).toEqual([
      { status: "legacy_unlinked", runId: "run_legacy_fixture" },
      { status: "linked", record: expect.objectContaining({ runId: root.runId }) },
    ]);
  });
});

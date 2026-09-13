import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { operatingContractHash } from "@lervo/work-controller";
import { sanitizeEventPayload } from "@lervo/event-contract";
import {
  claimAssignment,
  completeAssignment,
  createAssignment,
  listAssignments,
  registerAgent,
  reopenAssignment,
  type WorkforceAssignmentRecovery,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(kind: "rework" | "retry" = "rework", returned = false) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-recovery-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_recovery_001" }));
  const now = new Date();
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
  });
  const assignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    expectedPaths: ["src"],
    acceptanceCriteria: ["Preserve verified behavior"],
    verificationSuiteIds: ["role.development.artifact"],
  });
  const claim = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_first_attempt",
    now,
  });
  const artifact = {
    artifactId: "art_previous_result",
    contentHash: operatingContractHash("previous result"),
  };
  const completed = returned
    ? claim
    : await completeAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: agent.agentId,
        leaseId: claim.lease!.leaseId,
        resultArtifacts: [artifact],
        verificationStatus: kind === "rework" ? "passed" : "failed",
        now,
      });
  const recovery: WorkforceAssignmentRecovery = {
    kind,
    predecessorAssignmentHash: operatingContractHash(completed),
    responsibilityHash: operatingContractHash("original exact responsibility"),
    sourceRunId: "run_first_attempt",
    terminalEventId: "evt_first_terminal",
    reviewEventId: kind === "rework" ? "evt_owner_rejection" : null,
    attemptNumber: 2,
    predecessorLeaseGeneration: claim.lease!.generation,
  };
  return { root, agent, assignment, completed, recovery, artifact, now };
}

it.each(["rework", "retry"] as const)(
  "preserves %s lineage, artifacts and increasing lease generations",
  async (kind) => {
    const f = await fixture(kind);
    const events: WorkforceEvent[] = [];
    const reopened = await reopenAssignment({
      repositoryRoot: f.root,
      assignmentId: f.assignment.assignmentId,
      recovery: f.recovery,
      now: f.now,
      recordEvent: (event) => {
        events.push(event);
      },
    });
    expect(reopened).toMatchObject({
      status: "queued",
      lease: null,
      lastLeaseGeneration: 1,
      recovery: f.recovery,
      resultArtifacts: [f.artifact],
      revision: f.completed.revision + 1,
    });
    expect(events).toHaveLength(1);
    expect(sanitizeEventPayload("assignment.reopened", events[0]!.payload).payload).toEqual(
      events[0]!.payload,
    );
    await expect(
      reopenAssignment({
        repositoryRoot: f.root,
        assignmentId: f.assignment.assignmentId,
        recovery: f.recovery,
        now: f.now,
        recordEvent: () => undefined,
      }),
    ).rejects.toThrow(/exact terminal/iu);
    const claimed = await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: f.assignment.assignmentId,
      agentId: f.agent.agentId,
      sessionId: "ses_second_attempt",
      now: f.now,
    });
    expect(claimed.lease).toMatchObject({ generation: 2, sessionId: "ses_second_attempt" });
    expect(claimed.recovery).toEqual(f.recovery);
    expect(claimed.resultArtifacts).toEqual([f.artifact]);
  },
);

it("restores terminal bytes on receipt failure and rejects stale attempt or generation evidence", async () => {
  const f = await fixture();
  const input = {
    repositoryRoot: f.root,
    assignmentId: f.assignment.assignmentId,
    recovery: f.recovery,
    now: f.now,
    recordEvent: () => {
      throw new Error("lost_owner_fence");
    },
  };
  await expect(reopenAssignment(input)).rejects.toThrow(/restored/iu);
  expect((await listAssignments(f.root))[0]).toEqual(f.completed);
  for (const change of [
    { attemptNumber: 3 },
    { predecessorLeaseGeneration: 2 },
    { reviewEventId: null },
    { predecessorAssignmentHash: operatingContractHash("stale") },
  ]) {
    await expect(
      reopenAssignment({ ...input, recovery: { ...f.recovery, ...change } }),
    ).rejects.toThrow(/exact terminal/iu);
    expect((await listAssignments(f.root))[0]).toEqual(f.completed);
  }
});

it.each(["rework", "retry"] as const)(
  "reopens only the exact settled returned lease and restores it after receipt failure (%s)",
  async (kind) => {
    const f = await fixture(kind, true);
    const input = {
      repositoryRoot: f.root,
      assignmentId: f.assignment.assignmentId,
      recovery: f.recovery,
      now: f.now,
      recordEvent: () => undefined,
    };
    await expect(reopenAssignment(input)).rejects.toThrow(/exact terminal/iu);
    await expect(
      reopenAssignment({ ...input, settledLeaseId: "lse_" + "0".repeat(24) }),
    ).rejects.toThrow(/exact terminal/iu);
    const settledLeaseId = f.completed.lease!.leaseId;
    await expect(
      reopenAssignment({
        ...input,
        settledLeaseId,
        recordEvent: () => {
          throw new Error("lost_fence");
        },
      }),
    ).rejects.toThrow(/restored/iu);
    expect((await listAssignments(f.root))[0]).toEqual(f.completed);
    const reopened = await reopenAssignment({ ...input, settledLeaseId });
    expect(reopened).toMatchObject({
      status: "queued",
      lease: null,
      lastLeaseGeneration: 1,
      recovery: f.recovery,
    });
    const claimed = await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: f.assignment.assignmentId,
      agentId: f.agent.agentId,
      sessionId: "ses_reworked_return",
      now: f.now,
    });
    expect(claimed.lease?.generation).toBe(2);
  },
);

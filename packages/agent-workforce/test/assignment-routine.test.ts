import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimAssignment,
  createRoutineAssignment,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workforce-routine-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_routine_test_01",
      now: new Date("2026-09-02T04:00:00.000Z"),
    }),
  );
  return root;
}

describe("routine assignment materialization", () => {
  it("is idempotent, records bounded provenance, and enforces capability binding on claim", async () => {
    const root = await repository();
    const contract = await resolveRoleContract(root, "developer");
    const agent = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["src"],
    });
    const events: WorkforceEvent[] = [];
    const base = {
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
      priority: 50,
      dependencyIds: [],
      acceptanceCriteria: ["Implement the routine node."],
      verificationSuiteIds: ["project.quick"],
      approvalRequirements: [],
      expectedPaths: ["src/routine.ts"],
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      routine: {
        routineId: "change.review",
        templateVersion: "1.0.0",
        templateHash: `sha256:${"a".repeat(64)}`,
        invocationId: "rin_abcdefabcdefabcdefabcdef",
        triggerKind: "manual" as const,
        triggerDigest: `sha256:${"b".repeat(64)}`,
        nodeKey: "implement",
      },
      recordEvent: (event: WorkforceEvent) => {
        events.push(event);
      },
    };
    const incompatible = await createRoutineAssignment({
      ...base,
      requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
    });
    const replay = await createRoutineAssignment({
      ...base,
      requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
    });
    expect(replay.assignmentId).toBe(incompatible.assignmentId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assignment.created",
      payload: {
        assignmentId: incompatible.assignmentId,
        requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
        routineId: "change.review",
        routineInvocationId: "rin_abcdefabcdefabcdefabcdef",
        routineNodeKey: "implement",
      },
    });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: incompatible.assignmentId,
        agentId: agent.agentId,
        sessionId: "ses_routine_claim_01",
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });

    const compatible = await createRoutineAssignment({
      ...base,
      routine: { ...base.routine, nodeKey: "verify" },
      expectedPaths: ["src/verify.ts"],
      requiredCapabilityHash: agent.capabilityHash,
    });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: compatible.assignmentId,
        agentId: agent.agentId,
        sessionId: "ses_routine_claim_02",
      }),
    ).resolves.toMatchObject({ status: "leased", assigneeAgentId: agent.agentId });
  });

  it("rejects stale role bindings before creating routine state", async () => {
    const root = await repository();
    const contract = await resolveRoleContract(root, "developer");
    await expect(
      createRoutineAssignment({
        repositoryRoot: root,
        taskType: "implementation",
        roleId: "developer",
        roleVersion: "1.0.1",
        roleContractHash: contract.contractHash,
        requiredCapabilityHash: null,
        priority: 50,
        dependencyIds: [],
        acceptanceCriteria: ["Reject stale role coordinates."],
        verificationSuiteIds: ["project.quick"],
        approvalRequirements: [],
        expectedPaths: ["src/stale.ts"],
        workstreamId: "wks_abcdefabcdefabcdefabcdef",
        routine: {
          routineId: "change.review",
          templateVersion: "1.0.0",
          templateHash: `sha256:${"a".repeat(64)}`,
          invocationId: "rin_abcdefabcdefabcdefabcdef",
          triggerKind: "manual",
          triggerDigest: `sha256:${"b".repeat(64)}`,
          nodeKey: "stale",
        },
      }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });
});

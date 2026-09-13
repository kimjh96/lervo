import { operatingContractHash } from "@lervo/work-controller";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  registerAgent,
  createAssignment,
  claimAssignment,
  changeAgentStatus,
} from "@lervo/agent-workforce";
import { afterEach, describe, expect, it } from "vitest";
import {
  responsibility,
  now,
} from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { observeSupervisionWorkforce } from "../src/supervision-workforce-source.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(scope = "src") {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-workforce-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root }));
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: [scope],
  });
  const task = responsibility();
  Object.assign(task, {
    executorAgentId: agent.agentId,
    roleVersion: agent.roleVersion,
    roleContractHash: agent.roleContractHash,
    requiredCapabilities: ["filesystem.read"],
  });
  const input = {
    repositoryRoot: root,
    projectId: agent.projectId,
    ownerAgentId: agent.agentId,
    provider: "codex" as const,
    responsibility: task,
    now: () => now,
  };
  return { root, agent, task, input };
}
describe("actual workforce source", () => {
  it("admits existing root-scoped staff and observes another worker's root lease", async () => {
    const f = await fixture(".");
    expect((await observeSupervisionWorkforce(f.input)).candidates[0]!.status).toBe("available");
    const other = await registerAgent({
      repositoryRoot: f.root,
      roleId: "developer",
      provider: "codex",
      responsibilityPaths: ["."],
    });
    const assignment = await createAssignment({
      repositoryRoot: f.root,
      roleId: "developer",
      taskType: "implementation",
      acceptanceCriteria: f.task.acceptanceCriteria,
      verificationSuiteIds: f.task.verificationSuiteIds,
      expectedPaths: ["."],
    });
    await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: assignment.assignmentId,
      agentId: other.agentId,
      sessionId: "ses_other_root_worker",
      now: new Date(now),
    });
    expect(
      (await observeSupervisionWorkforce(f.input)).candidates.find(
        (item) => item.agentId === f.agent.agentId,
      ),
    ).toMatchObject({ status: "busy", reasonCodes: ["live_lease_conflict"] });
  });
  it("reads role and scope, and observes a new lease as capacity conflict", async () => {
    const f = await fixture();
    expect((await observeSupervisionWorkforce(f.input)).candidates[0]!.status).toBe("available");
    const assignment = await createAssignment({
      repositoryRoot: f.root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: f.task.acceptanceCriteria,
      verificationSuiteIds: f.task.verificationSuiteIds,
      expectedPaths: f.task.expectedPaths,
    });
    const claimed = await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: assignment.assignmentId,
      agentId: f.agent.agentId,
      sessionId: "ses_observed_worker",
      now: new Date(now),
    });
    expect(await observeSupervisionWorkforce(f.input)).toMatchObject({
      liveLeaseCount: 1,
      candidates: [{ status: "busy", reasonCodes: ["live_lease_conflict"] }],
    });
    f.task.assignmentId = claimed.assignmentId;
    f.task.assignmentRevision = claimed.revision + 2;
    const settledPredecessor = {
      assignmentHash: operatingContractHash(claimed),
      leaseId: claimed.lease!.leaseId,
    };
    expect(await observeSupervisionWorkforce({ ...f.input, settledPredecessor })).toMatchObject({
      liveLeaseCount: 0,
      candidates: [{ status: "available" }],
    });
    await expect(
      observeSupervisionWorkforce({
        ...f.input,
        settledPredecessor: { ...settledPredecessor, leaseId: "lse_" + "0".repeat(24) },
      }),
    ).rejects.toThrow(/exact predecessor/iu);
    expect((await observeSupervisionWorkforce(f.input)).candidates[0]!.status).toBe("busy");
  });
  it("rejects capabilities and paths outside actual staff scope", async () => {
    const f = await fixture();
    f.task.expectedPaths = ["private/report.md"];
    f.task.requiredCapabilities = ["network.access"];
    const result = await observeSupervisionWorkforce(f.input);
    expect(result.candidates[0]).toMatchObject({
      status: "incompatible",
      reasonCodes: ["capability_missing", "path_scope_missing"],
    });
  });
  it("observes suspended staff without presenting it as available", async () => {
    const f = await fixture();
    await changeAgentStatus({
      repositoryRoot: f.root,
      agentId: f.agent.agentId,
      expectedRevision: f.agent.revision,
      status: "suspended",
    });
    expect((await observeSupervisionWorkforce(f.input)).candidates[0]).toMatchObject({
      status: "incompatible",
      reasonCodes: ["ancestry_inactive"],
    });
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  claimAssignment,
  completeAssignment,
  createAssignment,
  readWorkspace,
  readWorkspaceIntegrationAttempt,
  registerAgent,
  updateWorkspace,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { GitWorkspaceHostAdapter, GitWorkspaceIntegrationAdapter } from "@lervo/workspace-host-git";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspaceIntegrationCandidate,
  applyWorkspaceProvision,
  applyWorkspaceSeal,
  planWorkspaceIntegrationCandidate,
  planWorkspaceProvision,
  planWorkspaceSeal,
} from "../src/index.js";
import { workspaceIntegrationCollisionReport } from "../src/workspace-integration-plan.js";

const execute = promisify(execFile);
const roots: string[] = [];
const hash = `sha256:${"a".repeat(64)}`;
const targetRef = "refs/heads/main";

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

async function activate(input: {
  repositoryRoot: string;
  workspaceId: string;
  sessionId: string;
  occurredAt: string;
}) {
  const stored = await readWorkspace(input.repositoryRoot, input.workspaceId);
  return (
    await updateWorkspace({
      repositoryRoot: input.repositoryRoot,
      workspaceId: input.workspaceId,
      expectedContentHash: stored!.contentHash,
      eventId: `evt_activate_${input.workspaceId.slice(4)}`,
      expectedRevision: stored!.workspace.revision,
      expectedGeneration: stored!.workspace.generation,
      nextState: "active",
      occurredAt: input.occurredAt,
      writerSession: { sessionId: input.sessionId, startedAt: input.occurredAt },
    })
  ).workspace;
}

async function fixture(options: { conflict?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-integration-"));
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-workspace-integration-parent-"));
  roots.push(root, parent);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_integration",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/base.ts"), "export const value = 'base';\n");
  await execute("git", ["-C", root, "init", "-b", "main"]);
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  const baseCommit = await git(root, "rev-parse", "HEAD");
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["*"],
    now: new Date("2026-08-26T00:00:01Z"),
  });
  const workerAssignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Sealed."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src"],
    now: new Date("2026-08-26T00:00:02Z"),
  });
  const workerLease = await claimAssignment({
    repositoryRoot: root,
    assignmentId: workerAssignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_worker_integration",
    now: new Date("2026-08-26T00:00:03Z"),
  });
  const host = new GitWorkspaceHostAdapter();
  const workerPath = resolve(parent, "worker");
  const workerProvision = await planWorkspaceProvision({
    repositoryRoot: root,
    workspacePath: workerPath,
    assignmentId: workerLease.assignmentId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    provider: "codex",
    baseCommit,
    integrationTargetDigest: repositoryCoordinateDigest(targetRef),
    executionKind: "worker",
    host,
    now: new Date("2026-08-26T00:00:04Z"),
  });
  const readyWorker = await applyWorkspaceProvision({
    plan: workerProvision,
    host,
    now: new Date("2026-08-26T00:00:05Z"),
  });
  const activeWorker = await activate({
    repositoryRoot: root,
    workspaceId: readyWorker.workspaceId,
    sessionId: "ses_worker_integration",
    occurredAt: "2026-08-26T00:00:06Z",
  });
  await writeFile(
    resolve(workerPath, options.conflict ? "src/base.ts" : "src/worker.ts"),
    options.conflict ? "export const value = 'worker';\n" : "export const worker = true;\n",
  );
  await git(workerPath, "add", "src");
  await git(workerPath, "commit", "-m", "worker result");
  const sealPlan = await planWorkspaceSeal({
    repositoryRoot: root,
    workspacePath: workerPath,
    workspaceId: activeWorker.workspaceId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    provider: "codex",
    writerSessionId: "ses_worker_integration",
    resultArtifactId: "art_workspace_result_integration",
    resultArtifactHash: hash,
    verificationResults: [
      {
        suiteId: "project.quick",
        policyHash: hash,
        resultArtifactId: "art_workspace_verify_integration",
        resultArtifactHash: hash,
        completedAt: "2026-08-26T00:00:07Z",
        passed: true,
      },
    ],
    host,
    now: new Date("2026-08-26T00:00:08Z"),
  });
  await applyWorkspaceSeal({
    plan: sealPlan,
    host,
    now: new Date("2026-08-26T00:00:09Z"),
  });
  await completeAssignment({
    repositoryRoot: root,
    assignmentId: workerLease.assignmentId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    resultArtifacts: [{ artifactId: "art_workspace_result_integration", contentHash: hash }],
    verificationStatus: "passed",
    now: new Date("2026-08-26T00:00:10Z"),
  });
  if (options.conflict) {
    await writeFile(resolve(root, "src/base.ts"), "export const value = 'target';\n");
    await git(root, "add", "src/base.ts");
    await git(root, "commit", "-m", "target result");
  }
  const targetBeforeCommit = await git(root, "rev-parse", targetRef);
  const integrationAssignment = await createAssignment({
    repositoryRoot: root,
    taskType: "repository.integration",
    roleId: "developer",
    acceptanceCriteria: ["Candidate prepared."],
    verificationSuiteIds: ["project.full"],
    expectedPaths: ["*"],
    now: new Date("2026-08-26T00:00:11Z"),
  });
  const integrationLease = await claimAssignment({
    repositoryRoot: root,
    assignmentId: integrationAssignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_integrator_workspace",
    now: new Date("2026-08-26T00:00:12Z"),
  });
  const integrationPath = resolve(parent, "integration");
  const integrationProvision = await planWorkspaceProvision({
    repositoryRoot: root,
    workspacePath: integrationPath,
    assignmentId: integrationLease.assignmentId,
    agentId: agent.agentId,
    leaseId: integrationLease.lease!.leaseId,
    provider: "codex",
    baseCommit: targetBeforeCommit,
    integrationTargetDigest: repositoryCoordinateDigest(targetRef),
    executionKind: "integrator",
    host,
    now: new Date("2026-08-26T00:00:13Z"),
  });
  const readyIntegrator = await applyWorkspaceProvision({
    plan: integrationProvision,
    host,
    now: new Date("2026-08-26T00:00:14Z"),
  });
  const activeIntegrator = await activate({
    repositoryRoot: root,
    workspaceId: readyIntegrator.workspaceId,
    sessionId: "ses_integrator_workspace",
    occurredAt: "2026-08-26T00:00:15Z",
  });
  const integrationHost = new GitWorkspaceIntegrationAdapter(host);
  return {
    root,
    workerPath,
    integrationPath,
    worker: activeWorker,
    integrator: activeIntegrator,
    agent,
    integrationLease,
    targetBeforeCommit,
    integrationHost,
  };
}

async function plan(current: Awaited<ReturnType<typeof fixture>>) {
  return planWorkspaceIntegrationCandidate({
    repositoryRoot: current.root,
    integrationWorkspacePath: current.integrationPath,
    integrationWorkspaceId: current.integrator.workspaceId,
    integratorAgentId: current.agent.agentId,
    integratorWriterSessionId: "ses_integrator_workspace",
    leaseId: current.integrationLease.lease!.leaseId,
    provider: "codex",
    targetRef,
    targetGeneration: 1,
    selectedWorkspaceIds: [current.worker.workspaceId],
    integrationHost: current.integrationHost,
    now: new Date("2026-08-26T00:00:16Z"),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace integration candidate orchestration", () => {
  it("reports overlapping source paths without retaining the paths", () => {
    const report = workspaceIntegrationCollisionReport([
      { workspaceId: `wsp_${"1".repeat(24)}`, changedPaths: ["src/shared.ts", "src/a.ts"] },
      { workspaceId: `wsp_${"2".repeat(24)}`, changedPaths: ["src/shared.ts", "src/b.ts"] },
    ]);
    expect(report).toMatchObject({ changedPathUnionCount: 3 });
    expect(report.collisions).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("src/shared.ts");
  });

  it("prepares one exact candidate while preserving the target ref", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    expect(integrationPlan).toMatchObject({
      targetBeforeCommit: current.targetBeforeCommit,
      changedPathUnionCount: 1,
      collisions: [],
    });
    const result = await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    expect(result).toMatchObject({ status: "candidate", targetUnchanged: true });
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
    expect(await git(current.integrationPath, "rev-parse", "HEAD")).toBe(result.candidateCommit);
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integrating",
    );
    await expect(
      applyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:18Z"),
      }),
    ).resolves.toEqual(result);
  }, 20_000);

  it("rejects a stale target before acquiring the integration attempt", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    await writeFile(resolve(current.root, "src/target.ts"), "export const target = true;\n");
    await git(current.root, "add", "src/target.ts");
    await git(current.root, "commit", "-m", "advance target");
    await expect(
      applyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:17Z"),
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });
    expect(
      await readWorkspaceIntegrationAttempt(current.root, integrationPlan.attempt.targetLeaseId),
    ).toBeNull();
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integration_pending",
    );
  }, 20_000);

  it("aborts a Git conflict exactly and records no target success", async () => {
    const current = await fixture({ conflict: true });
    const integrationPlan = await plan(current);
    const result = await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    expect(result).toMatchObject({
      status: "conflict",
      operationAborted: true,
      targetUnchanged: true,
      conflictWorkspaceId: current.worker.workspaceId,
    });
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
    expect(await git(current.integrationPath, "rev-parse", "HEAD")).toBe(
      current.targetBeforeCommit,
    );
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integration_conflict",
    );
  }, 20_000);
});

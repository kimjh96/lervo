import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  claimAssignment,
  createAssignment,
  listWorkspaceIntegrationQueue,
  readWorkspace,
  registerAgent,
  renewAssignmentLease,
  updateWorkspace,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspaceProvision,
  applyWorkspaceSeal,
  planWorkspaceProvision,
  planWorkspaceSeal,
} from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const hash = `sha256:${"a".repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-seal-"));
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-workspace-seal-parent-"));
  roots.push(root, parent);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_seal",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/base.ts"), "export const base = true;\n");
  await execute("git", ["-C", root, "init"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
    now: new Date("2026-08-26T00:00:01Z"),
  });
  const assignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Sealed."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src"],
    now: new Date("2026-08-26T00:00:02Z"),
  });
  const claimed = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_workspace_sealing",
    now: new Date("2026-08-26T00:00:03Z"),
  });
  const host = new GitWorkspaceHostAdapter();
  const workspacePath = resolve(parent, "worker");
  const provision = await planWorkspaceProvision({
    repositoryRoot: root,
    workspacePath,
    assignmentId: claimed.assignmentId,
    agentId: agent.agentId,
    leaseId: claimed.lease!.leaseId,
    provider: "codex",
    baseCommit: stdout.trim(),
    integrationTargetDigest: hash,
    executionKind: "worker",
    host,
    now: new Date("2026-08-26T00:00:04Z"),
  });
  const ready = await applyWorkspaceProvision({
    plan: provision,
    host,
    now: new Date("2026-08-26T00:00:05Z"),
  });
  const stored = await readWorkspace(root, ready.workspaceId);
  const active = await updateWorkspace({
    repositoryRoot: root,
    workspaceId: ready.workspaceId,
    expectedContentHash: stored!.contentHash,
    eventId: "evt_workspace_seal_active",
    expectedRevision: ready.revision,
    expectedGeneration: ready.generation,
    nextState: "active",
    occurredAt: "2026-08-26T00:00:06Z",
    writerSession: { sessionId: "ses_workspace_sealing", startedAt: "2026-08-26T00:00:06Z" },
  });
  return { root, workspacePath, agent, assignment: claimed, workspace: active.workspace, host };
}

function verification(passed = true) {
  return [
    {
      suiteId: "project.quick",
      policyHash: hash,
      resultArtifactId: "art_workspace_verify_01",
      resultArtifactHash: hash,
      completedAt: "2026-08-26T00:00:08Z",
      passed,
    },
  ];
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace sealing orchestration", () => {
  it("seals exact committed bytes and exposes only a committed queue entry", async () => {
    const current = await fixture();
    await writeFile(
      resolve(current.workspacePath, "src/result.ts"),
      "export const result = true;\n",
    );
    await execute("git", ["-C", current.workspacePath, "add", "src/result.ts"]);
    await execute("git", ["-C", current.workspacePath, "commit", "-m", "result"]);
    const plan = await planWorkspaceSeal({
      repositoryRoot: current.root,
      workspacePath: current.workspacePath,
      workspaceId: current.workspace.workspaceId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      provider: "codex",
      writerSessionId: "ses_workspace_sealing",
      resultArtifactId: "art_workspace_result_01",
      resultArtifactHash: hash,
      verificationResults: verification(),
      host: current.host,
      now: new Date("2026-08-26T00:00:09Z"),
    });
    expect(
      (await readWorkspace(current.root, current.workspace.workspaceId))!.workspace.state,
    ).toBe("active");
    expect(await listWorkspaceIntegrationQueue({ repositoryRoot: current.root })).toEqual([]);

    const sealed = await applyWorkspaceSeal({
      plan,
      host: current.host,
      now: new Date("2026-08-26T00:00:10Z"),
    });
    expect(sealed).toMatchObject({
      state: "integration_pending",
      writerSession: null,
      integrationQueueEntryId: plan.queueEntry.queueEntryId,
      sealedResult: {
        changedPaths: ["src/result.ts"],
        changedPathCount: 1,
        noChange: false,
      },
    });
    expect(await listWorkspaceIntegrationQueue({ repositoryRoot: current.root })).toEqual([
      plan.queueEntry,
    ]);
    const records = await RepositoryCoordinationRecords.open(current.root);
    expect(JSON.stringify(await records.list("events"))).not.toContain(current.workspacePath);
    expect(JSON.stringify(await records.list("integrations"))).not.toContain(current.workspacePath);
    expect(
      await applyWorkspaceSeal({
        plan,
        host: current.host,
        now: new Date("2026-08-26T00:00:11Z"),
      }),
    ).toEqual(sealed);
  });

  it("seals an explicit no-change disposition without inventing commits", async () => {
    const current = await fixture();
    const plan = await planWorkspaceSeal({
      repositoryRoot: current.root,
      workspacePath: current.workspacePath,
      workspaceId: current.workspace.workspaceId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      provider: "codex",
      writerSessionId: "ses_workspace_sealing",
      resultArtifactId: "art_workspace_result_05",
      resultArtifactHash: hash,
      verificationResults: verification(),
      host: current.host,
      now: new Date("2026-08-26T00:00:09Z"),
    });
    expect(plan.sealedResult).toMatchObject({
      noChange: true,
      commitIds: [],
      changedPaths: [],
      changedPathCount: 0,
    });
    await expect(
      applyWorkspaceSeal({
        plan,
        host: current.host,
        now: new Date("2026-08-26T00:00:10Z"),
      }),
    ).resolves.toMatchObject({ state: "integration_pending" });
  });

  it("rejects apply after assignment lease generation changes", async () => {
    const current = await fixture();
    await writeFile(
      resolve(current.workspacePath, "src/result.ts"),
      "export const result = true;\n",
    );
    await execute("git", ["-C", current.workspacePath, "add", "src/result.ts"]);
    await execute("git", ["-C", current.workspacePath, "commit", "-m", "result"]);
    const plan = await planWorkspaceSeal({
      repositoryRoot: current.root,
      workspacePath: current.workspacePath,
      workspaceId: current.workspace.workspaceId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      provider: "codex",
      writerSessionId: "ses_workspace_sealing",
      resultArtifactId: "art_workspace_result_06",
      resultArtifactHash: hash,
      verificationResults: verification(),
      host: current.host,
      now: new Date("2026-08-26T00:00:09Z"),
    });
    await renewAssignmentLease({
      repositoryRoot: current.root,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      now: new Date("2026-08-26T00:00:10Z"),
    });
    await expect(
      applyWorkspaceSeal({
        plan,
        host: current.host,
        now: new Date("2026-08-26T00:00:11Z"),
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });
    expect(
      (await readWorkspace(current.root, current.workspace.workspaceId))!.workspace.state,
    ).toBe("active");
  });

  it("rejects dirty, foreign-path, and failed-verification results before freezing the writer", async () => {
    const dirty = await fixture();
    await writeFile(resolve(dirty.workspacePath, "src/untracked.ts"), "preserve me\n");
    await expect(
      planWorkspaceSeal({
        repositoryRoot: dirty.root,
        workspacePath: dirty.workspacePath,
        workspaceId: dirty.workspace.workspaceId,
        agentId: dirty.agent.agentId,
        leaseId: dirty.assignment.lease!.leaseId,
        provider: "codex",
        writerSessionId: "ses_workspace_sealing",
        resultArtifactId: "art_workspace_result_02",
        resultArtifactHash: hash,
        verificationResults: verification(),
        host: dirty.host,
        now: new Date("2026-08-26T00:00:09Z"),
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });

    await execute("git", ["-C", dirty.workspacePath, "clean", "-f"]);
    await writeFile(resolve(dirty.workspacePath, "foreign.ts"), "foreign\n");
    await execute("git", ["-C", dirty.workspacePath, "add", "foreign.ts"]);
    await execute("git", ["-C", dirty.workspacePath, "commit", "-m", "foreign"]);
    await expect(
      planWorkspaceSeal({
        repositoryRoot: dirty.root,
        workspacePath: dirty.workspacePath,
        workspaceId: dirty.workspace.workspaceId,
        agentId: dirty.agent.agentId,
        leaseId: dirty.assignment.lease!.leaseId,
        provider: "codex",
        writerSessionId: "ses_workspace_sealing",
        resultArtifactId: "art_workspace_result_03",
        resultArtifactHash: hash,
        verificationResults: verification(),
        host: dirty.host,
        now: new Date("2026-08-26T00:00:10Z"),
      }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });

    await expect(
      planWorkspaceSeal({
        repositoryRoot: dirty.root,
        workspacePath: dirty.workspacePath,
        workspaceId: dirty.workspace.workspaceId,
        agentId: dirty.agent.agentId,
        leaseId: dirty.assignment.lease!.leaseId,
        provider: "codex",
        writerSessionId: "ses_workspace_sealing",
        resultArtifactId: "art_workspace_result_04",
        resultArtifactHash: hash,
        verificationResults: verification(false),
        host: dirty.host,
        now: new Date("2026-08-26T00:00:11Z"),
      }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
    expect((await readWorkspace(dirty.root, dirty.workspace.workspaceId))!.workspace.state).toBe(
      "active",
    );
  });
});

import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  claimAssignment,
  createAssignment,
  listWorkspaces,
  registerAgent,
  renewAssignmentLease,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { afterEach, describe, expect, it } from "vitest";

import { applyWorkspaceProvision, planWorkspaceProvision } from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const targetDigest = `sha256:${"a".repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-provision-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_provision",
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
    acceptanceCriteria: ["Provisioned."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src"],
    now: new Date("2026-08-26T00:00:02Z"),
  });
  const claimed = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_workspace_provision",
    now: new Date("2026-08-26T00:00:03Z"),
  });
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-workspace-provision-parent-"));
  roots.push(parent);
  return {
    root,
    parent,
    baseCommit: stdout.trim(),
    agent,
    assignment: claimed,
    workspacePath: resolve(parent, "worker"),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace provisioning orchestration", () => {
  it("keeps planning read-only and applies one content-bound Git workspace", async () => {
    const current = await fixture();
    const host = new GitWorkspaceHostAdapter();
    const plan = await planWorkspaceProvision({
      repositoryRoot: current.root,
      workspacePath: current.workspacePath,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      provider: "codex",
      baseCommit: current.baseCommit,
      integrationTargetDigest: targetDigest,
      executionKind: "worker",
      host,
      now: new Date("2026-08-26T00:00:04Z"),
    });
    await expect(lstat(current.workspacePath)).rejects.toThrow();
    expect(await listWorkspaces(current.root)).toEqual([]);

    const applied = await applyWorkspaceProvision({
      plan,
      host,
      now: new Date("2026-08-26T00:00:05Z"),
    });
    expect(applied).toMatchObject({
      workspaceId: plan.workspace.workspaceId,
      state: "ready",
      revision: 2,
      host: { kind: "git", nativeInstanceDigest: expect.stringMatching(/^sha256:/u) },
    });
    expect(
      await applyWorkspaceProvision({ plan, host, now: new Date("2026-08-26T00:00:06Z") }),
    ).toEqual(applied);
  });

  it("rejects a plan after the assignment lease revision changes", async () => {
    const current = await fixture();
    const host = new GitWorkspaceHostAdapter();
    const plan = await planWorkspaceProvision({
      repositoryRoot: current.root,
      workspacePath: current.workspacePath,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      provider: "codex",
      baseCommit: current.baseCommit,
      integrationTargetDigest: targetDigest,
      executionKind: "worker",
      host,
      now: new Date("2026-08-26T00:00:04Z"),
    });
    await renewAssignmentLease({
      repositoryRoot: current.root,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      leaseId: current.assignment.lease!.leaseId,
      now: new Date("2026-08-26T00:00:05Z"),
    });

    await expect(
      applyWorkspaceProvision({ plan, host, now: new Date("2026-08-26T00:00:06Z") }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
    await expect(lstat(current.workspacePath)).rejects.toThrow();
  });
});

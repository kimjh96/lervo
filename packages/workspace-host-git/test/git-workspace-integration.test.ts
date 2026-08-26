import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceHostAdapter, GitWorkspaceIntegrationAdapter } from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function git(root: string, arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

function marker(seed: string) {
  return {
    schemaVersion: 1 as const,
    workspaceId: `wsp_${seed.repeat(24).slice(0, 24)}`,
    generation: 1,
    repositoryInstanceId: "rpi_0123456789abcdef01234567",
    adapterKind: "git" as const,
    adapterVersion: "1.0.0",
    creationPlanId: `wpl_${seed.repeat(24).slice(0, 24)}`,
    pathDigest: `sha256:${seed.repeat(64).slice(0, 64)}`,
  };
}

async function fixture(conflict: boolean) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-integration-"));
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-git-integration-parent-"));
  roots.push(root, parent);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "lervo-test@example.invalid"]);
  await git(root, ["config", "user.name", "Lervo Test"]);
  await writeFile(resolve(root, "shared.txt"), "base\n");
  await git(root, ["add", "shared.txt"]);
  await git(root, ["commit", "-m", "base"]);
  const baseCommit = await git(root, ["rev-parse", "HEAD"]);

  const workerPath = resolve(parent, "worker");
  await git(root, ["worktree", "add", "--detach", workerPath, baseCommit]);
  await writeFile(
    resolve(workerPath, conflict ? "shared.txt" : "worker.txt"),
    conflict ? "worker\n" : "worker result\n",
  );
  await git(workerPath, ["add", "."]);
  await git(workerPath, ["commit", "-m", "worker result"]);
  const sourceHead = await git(workerPath, ["rev-parse", "HEAD"]);

  let targetBeforeCommit = baseCommit;
  if (conflict) {
    await writeFile(resolve(root, "shared.txt"), "target\n");
    await git(root, ["add", "shared.txt"]);
    await git(root, ["commit", "-m", "target result"]);
    targetBeforeCommit = await git(root, ["rev-parse", "HEAD"]);
  }
  await git(root, ["branch", "integration-target", targetBeforeCommit]);
  const integrationWorkspacePath = resolve(parent, "integration");
  const integrationMarker = marker("a");
  const workspaceHost = new GitWorkspaceHostAdapter();
  await workspaceHost.provision({
    repositoryRoot: root,
    workspacePath: integrationWorkspacePath,
    baseCommit: targetBeforeCommit,
    marker: integrationMarker,
    idempotencyKey: "idk_integration_provision_01",
  });
  const integrationHost = new GitWorkspaceIntegrationAdapter(workspaceHost);
  return {
    root,
    baseCommit,
    sourceHead,
    targetBeforeCommit,
    integrationWorkspacePath,
    integrationMarker,
    integrationHost,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git workspace integration", () => {
  it("prepares and resets an exact candidate without advancing the target ref", async () => {
    const current = await fixture(false);
    const request = {
      repositoryRoot: current.root,
      integrationWorkspacePath: current.integrationWorkspacePath,
      integrationBaseCommit: current.targetBeforeCommit,
      integrationMarker: current.integrationMarker,
      targetRef: "refs/heads/integration-target",
      targetBeforeCommit: current.targetBeforeCommit,
      attemptId: "int_0123456789abcdef01234567",
      idempotencyKey: "idk_integration_apply_0001",
      sources: [
        {
          workspaceId: "wsp_111111111111111111111111",
          generation: 1,
          headCommit: current.sourceHead,
          commitIds: [current.sourceHead],
          strategy: "cherry_pick" as const,
        },
      ],
      commitTime: "2026-08-26T00:00:00Z",
    };
    const result = await current.integrationHost.applyIntegration(request);
    expect(result).toMatchObject({
      status: "candidate",
      targetBeforeCommit: current.targetBeforeCommit,
      targetUnchanged: true,
      operationAborted: false,
    });
    expect(result.candidateCommit).not.toBe(current.targetBeforeCommit);
    expect(await git(current.root, ["rev-parse", "refs/heads/integration-target"])).toBe(
      current.targetBeforeCommit,
    );
    await expect(
      current.integrationHost.resetCandidate({
        ...request,
        candidateCommit: result.candidateCommit!,
        idempotencyKey: "idk_integration_reset_0001",
      }),
    ).resolves.toBe(true);
    expect(await git(current.integrationWorkspacePath, ["rev-parse", "HEAD"])).toBe(
      current.targetBeforeCommit,
    );
  });

  it("aborts a cherry-pick conflict and restores the exact target-before state", async () => {
    const current = await fixture(true);
    const result = await current.integrationHost.applyIntegration({
      repositoryRoot: current.root,
      integrationWorkspacePath: current.integrationWorkspacePath,
      integrationBaseCommit: current.targetBeforeCommit,
      integrationMarker: current.integrationMarker,
      targetRef: "refs/heads/integration-target",
      targetBeforeCommit: current.targetBeforeCommit,
      attemptId: "int_222222222222222222222222",
      idempotencyKey: "idk_integration_apply_0002",
      sources: [
        {
          workspaceId: "wsp_222222222222222222222222",
          generation: 1,
          headCommit: current.sourceHead,
          commitIds: [current.sourceHead],
          strategy: "cherry_pick",
        },
      ],
      commitTime: "2026-08-26T00:00:00Z",
    });
    expect(result).toEqual({
      status: "conflict",
      targetBeforeCommit: current.targetBeforeCommit,
      candidateCommit: null,
      candidateTreeHash: null,
      conflictWorkspaceId: "wsp_222222222222222222222222",
      conflictReason: "git_conflict",
      operationAborted: true,
      targetUnchanged: true,
    });
    expect(await git(current.integrationWorkspacePath, ["rev-parse", "HEAD"])).toBe(
      current.targetBeforeCommit,
    );
    expect(await git(current.integrationWorkspacePath, ["status", "--porcelain"])).toBe("");
    expect(await git(current.root, ["rev-parse", "refs/heads/integration-target"])).toBe(
      current.targetBeforeCommit,
    );
  });
});

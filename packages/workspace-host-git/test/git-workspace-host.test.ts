import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceHostAdapter } from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const marker = {
  schemaVersion: 1 as const,
  workspaceId: "wsp_0123456789abcdef01234567",
  generation: 1,
  repositoryInstanceId: "rpi_0123456789abcdef01234567",
  adapterKind: "git" as const,
  adapterVersion: "1.0.0",
  creationPlanId: "wpl_0123456789abcdef01234567",
  pathDigest: `sha256:${"a".repeat(64)}`,
};

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-host-"));
  roots.push(root);
  await execute("git", ["-C", root, "init"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await writeFile(resolve(root, "tracked.txt"), "base\n");
  await execute("git", ["-C", root, "add", "tracked.txt"]);
  await execute("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-git-host-parent-"));
  roots.push(parent);
  return {
    repositoryRoot: root,
    parent,
    baseCommit: stdout.trim(),
    workspacePath: resolve(parent, "worker"),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git workspace host", () => {
  it.each(["unchanged", "unstaged", "staged", "untracked", "committed"])(
    "observes base-relative changed paths for %s workspaces",
    async (state) => {
      const fixture = await repository();
      const adapter = new GitWorkspaceHostAdapter();
      const request = { ...fixture, marker, idempotencyKey: "idk_inspection_fixture_01" };
      await adapter.provision(request);
      if (state !== "unchanged")
        await writeFile(
          resolve(fixture.workspacePath, state === "untracked" ? "new.txt" : "tracked.txt"),
          "changed\n",
        );
      if (state === "staged" || state === "committed")
        await execute("git", ["-C", fixture.workspacePath, "add", "tracked.txt"]);
      if (state === "committed")
        await execute("git", ["-C", fixture.workspacePath, "commit", "-m", "changed"]);
      const observed = await adapter.inspect(request);
      expect(observed).toMatchObject({
        status: "present",
        markerMatched: true,
        clean: state === "unchanged" || state === "committed",
        changedPaths:
          state === "unchanged" ? [] : [state === "untracked" ? "new.txt" : "tracked.txt"],
      });
      expect(observed.headCommit === fixture.baseCommit).toBe(state !== "committed");
    },
  );

  it("provisions on a new branch and deletes that branch only while it has not moved", async () => {
    const fixture = await repository();
    const adapter = new GitWorkspaceHostAdapter();
    const request = {
      ...fixture,
      marker,
      idempotencyKey: "idk_branch_fixture_0001",
      branch: "lervo/fix-the-build-1a2b3c",
    };
    expect(await adapter.provisionBranch(request)).toMatchObject({
      status: "present",
      headCommit: fixture.baseCommit,
      markerMatched: true,
    });
    const { stdout: branch } = await execute("git", [
      "-C",
      fixture.workspacePath,
      "branch",
      "--show-current",
    ]);
    expect(branch.trim()).toBe(request.branch);
    await expect(
      adapter.provisionBranch({
        ...request,
        workspacePath: resolve(fixture.parent, "second"),
        idempotencyKey: "idk_branch_fixture_0002",
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });

    await writeFile(resolve(fixture.workspacePath, "tracked.txt"), "moved\n");
    await execute("git", ["-C", fixture.workspacePath, "commit", "-am", "moved"]);
    const removal = {
      repositoryRoot: fixture.repositoryRoot,
      branch: request.branch,
      expectedCommit: fixture.baseCommit,
    };
    await adapter.removeDiscardingChanges({ ...request, idempotencyKey: "idk_branch_remove_001" });
    await expect(adapter.removeBranch(removal)).rejects.toMatchObject({
      code: "host_effect_uncertain",
    });
    await execute("git", [
      "-C",
      fixture.repositoryRoot,
      "branch",
      "-f",
      request.branch,
      fixture.baseCommit,
    ]);
    await adapter.removeBranch(removal);
    const { stdout: left } = await execute("git", [
      "-C",
      fixture.repositoryRoot,
      "branch",
      "--list",
      request.branch,
    ]);
    expect(left.trim()).toBe("");
    await adapter.removeBranch(removal);
  });

  it("rejects a branch name that Git would not accept", async () => {
    const fixture = await repository();
    await expect(
      new GitWorkspaceHostAdapter().provisionBranch({
        ...fixture,
        marker,
        idempotencyKey: "idk_branch_fixture_0003",
        branch: "-bad",
      }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
  });

  it("provisions idempotently, inspects exact evidence, and removes without force", async () => {
    const fixture = await repository();
    const adapter = new GitWorkspaceHostAdapter();
    const request = {
      ...fixture,
      marker,
      idempotencyKey: "idk_provision_fixture_01",
    };
    const provisioned = await adapter.provision(request);
    expect(provisioned).toMatchObject({
      status: "present",
      headCommit: fixture.baseCommit,
      clean: true,
      markerMatched: true,
      processObservation: "unavailable",
    });
    expect(await adapter.provision(request)).toEqual(provisioned);
    expect(await adapter.inspectResult(request)).toMatchObject({
      baseCommitReachable: true,
      commitIds: [],
    });
    const { stdout: gitDirectory } = await execute("git", [
      "-C",
      fixture.workspacePath,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);
    expect(
      JSON.parse(
        await readFile(resolve(gitDirectory.trim(), "lervo-workspace-owner.json"), "utf8"),
      ),
    ).toEqual(marker);

    expect(
      await adapter.remove({
        repositoryRoot: fixture.repositoryRoot,
        workspacePath: fixture.workspacePath,
        baseCommit: fixture.baseCommit,
        marker,
        idempotencyKey: "idk_remove_fixture_001",
      }),
    ).toMatchObject({ status: "absent" });
  });

  it("keeps dirty worktrees and their untracked bytes", async () => {
    const fixture = await repository();
    const adapter = new GitWorkspaceHostAdapter();
    await adapter.provision({
      ...fixture,
      marker,
      idempotencyKey: "idk_provision_fixture_02",
    });
    await writeFile(resolve(fixture.workspacePath, "untracked.txt"), "preserve me\n");

    await expect(
      adapter.remove({
        repositoryRoot: fixture.repositoryRoot,
        workspacePath: fixture.workspacePath,
        baseCommit: fixture.baseCommit,
        marker,
        idempotencyKey: "idk_remove_fixture_002",
      }),
    ).rejects.toMatchObject({ code: "host_not_clean" });
    expect(await readFile(resolve(fixture.workspacePath, "untracked.txt"), "utf8")).toBe(
      "preserve me\n",
    );
  });

  it("discards uncommitted bytes only on explicit request and still checks the marker", async () => {
    const fixture = await repository();
    const adapter = new GitWorkspaceHostAdapter();
    const request = { ...fixture, marker, idempotencyKey: "idk_discard_fixture_01" };
    await adapter.provision(request);
    await writeFile(resolve(fixture.workspacePath, "tracked.txt"), "verification rewrite\n");
    await writeFile(resolve(fixture.workspacePath, "untracked.txt"), "generated\n");

    await expect(
      adapter.removeDiscardingChanges({
        ...request,
        marker: { ...marker, creationPlanId: "wpl_fedcba9876543210fedcba98" },
      }),
    ).rejects.toMatchObject({ code: "host_marker_mismatch" });
    expect(await readFile(resolve(fixture.workspacePath, "untracked.txt"), "utf8")).toBe(
      "generated\n",
    );
    expect(await adapter.removeDiscardingChanges(request)).toMatchObject({ status: "absent" });
    const { stdout } = await execute("git", ["-C", fixture.repositoryRoot, "worktree", "list"]);
    expect(stdout).not.toContain(fixture.workspacePath);
  });
});

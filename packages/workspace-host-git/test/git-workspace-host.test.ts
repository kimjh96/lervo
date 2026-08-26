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
});

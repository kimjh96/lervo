import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceHostAdapter } from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const first = {
  schemaVersion: 1 as const,
  workspaceId: "wsp_0123456789abcdef01234567",
  generation: 1,
  repositoryInstanceId: "rpi_0123456789abcdef01234567",
  adapterKind: "git" as const,
  adapterVersion: "1.0.0",
  creationPlanId: "wpl_0123456789abcdef01234567",
  pathDigest: `sha256:${"a".repeat(64)}`,
};
const second = {
  ...first,
  workspaceId: "wsp_1123456789abcdef01234567",
  generation: 2,
  creationPlanId: "wpl_1123456789abcdef01234567",
};

/** A provisioned worktree whose marker names generation 1. */
async function provisioned() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-marker-"));
  roots.push(root);
  const repositoryRoot = resolve(root, "repository");
  await execute("git", ["init", repositoryRoot]);
  await execute("git", ["-C", repositoryRoot, "config", "user.email", "lervo@example.invalid"]);
  await execute("git", ["-C", repositoryRoot, "config", "user.name", "Lervo Test"]);
  await writeFile(resolve(repositoryRoot, "tracked.txt"), "base\n");
  await execute("git", ["-C", repositoryRoot, "add", "tracked.txt"]);
  await execute("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]);
  const workspacePath = resolve(root, "worker");
  const adapter = new GitWorkspaceHostAdapter();
  await adapter.provision({
    repositoryRoot,
    workspacePath,
    baseCommit: stdout.trim(),
    marker: first,
    idempotencyKey: "idk_marker_fixture_0001",
  });
  const gitDirectory = (
    await execute("git", ["-C", workspacePath, "rev-parse", "--path-format=absolute", "--git-dir"])
  ).stdout.trim();
  const inspect = (marker: typeof first) =>
    adapter.inspect({ repositoryRoot, workspacePath, baseCommit: stdout.trim(), marker });
  return {
    adapter,
    workspacePath,
    markerPath: resolve(gitDirectory, "lervo-workspace-owner.json"),
    inspect,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git workspace marker replacement", () => {
  it("moves the marker to the next generation only from the expected one", async () => {
    const fixture = await provisioned();
    await fixture.adapter.replaceMarker({
      workspacePath: fixture.workspacePath,
      expected: first,
      next: second,
    });
    expect((await fixture.inspect(second)).markerMatched).toBe(true);
    expect((await fixture.inspect(first)).markerMatched).toBe(false);
    expect((await stat(fixture.markerPath)).mode & 0o777).toBe(0o600);

    // A second replacement from the old generation loses: the marker stays where it moved.
    await expect(
      fixture.adapter.replaceMarker({
        workspacePath: fixture.workspacePath,
        expected: first,
        next: second,
      }),
    ).rejects.toMatchObject({ code: "host_marker_mismatch" });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(second);
  });

  it("refuses a next marker that is not the following generation of the same checkout", async () => {
    const fixture = await provisioned();
    for (const next of [
      { ...second, generation: 3 },
      { ...second, pathDigest: `sha256:${"b".repeat(64)}` },
      { ...second, repositoryInstanceId: "rpi_1123456789abcdef01234567" },
    ])
      await expect(
        fixture.adapter.replaceMarker({
          workspacePath: fixture.workspacePath,
          expected: first,
          next,
        }),
      ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(first);
  });

  it("waits for no live replacement and recovers a lock whose process is gone", async () => {
    const fixture = await provisioned();
    const lock = `${fixture.markerPath}.lock`;
    await writeFile(lock, `${process.pid}\n`);
    await expect(
      fixture.adapter.replaceMarker({
        workspacePath: fixture.workspacePath,
        expected: first,
        next: second,
      }),
    ).rejects.toMatchObject({ code: "host_operation_in_progress" });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(first);

    // No process has this ID, so the lock is a crashed replacement's and is taken over.
    await writeFile(lock, "2147483646\n");
    await fixture.adapter.replaceMarker({
      workspacePath: fixture.workspacePath,
      expected: first,
      next: second,
    });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(second);
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceHostAdapter } from "../src/index.js";
import {
  acquireMarkerLock,
  MARKER_LOCK_GRACE_MS,
  MARKER_LOCK_STALE_MS,
} from "../src/marker-lock.js";

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

/** A lock as a holder writes it; by default this host's, past the stale gate. */
function lockContent(holder: {
  pid: number;
  hostname?: string;
  createdAt?: Date;
  token?: string;
}): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    token: holder.token ?? "crashed-holder",
    pid: holder.pid,
    hostname: holder.hostname ?? hostname(),
    createdAt: (holder.createdAt ?? new Date(Date.now() - 2 * MARKER_LOCK_STALE_MS)).toISOString(),
  })}\n`;
}

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

  it("refuses while a live replacement holds the lock and takes over a crashed one", async () => {
    const fixture = await provisioned();
    const lock = `${fixture.markerPath}.lock`;
    const replace = () =>
      fixture.adapter.replaceMarker({
        workspacePath: fixture.workspacePath,
        expected: first,
        next: second,
      });
    // A young lock is live whatever its process, and another host's lock is never stale.
    await writeFile(lock, lockContent({ pid: 2147483646, createdAt: new Date() }));
    await expect(replace()).rejects.toMatchObject({ code: "host_operation_in_progress" });
    await writeFile(lock, lockContent({ pid: 2147483646, hostname: "another-host" }));
    await expect(replace()).rejects.toMatchObject({ code: "host_operation_in_progress" });
    // An old lock of this host whose process is alive still holds.
    await writeFile(lock, lockContent({ pid: process.pid }));
    await expect(replace()).rejects.toMatchObject({ code: "host_operation_in_progress" });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(first);

    // No process has this ID and the lock is past the gate: a crashed replacement's, taken over.
    await writeFile(lock, lockContent({ pid: 2147483646 }));
    await replace();
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(second);
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats an empty lock as a partial write until its grace has passed", async () => {
    const fixture = await provisioned();
    const lock = `${fixture.markerPath}.lock`;
    await writeFile(lock, "");
    await expect(
      fixture.adapter.replaceMarker({
        workspacePath: fixture.workspacePath,
        expected: first,
        next: second,
      }),
    ).rejects.toMatchObject({ code: "host_operation_in_progress" });
    const past = new Date(Date.now() - 2 * MARKER_LOCK_GRACE_MS);
    await utimes(lock, past, past);
    await fixture.adapter.replaceMarker({
      workspacePath: fixture.workspacePath,
      expected: first,
      next: second,
    });
    expect(JSON.parse(await readFile(fixture.markerPath, "utf8"))).toEqual(second);
  });
});

describe("the marker lock", () => {
  it("lets exactly one of two concurrent takeovers of a stale lock hold it", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-marker-lock-"));
    roots.push(root);
    const lock = resolve(root, "marker.lock");
    await writeFile(lock, lockContent({ pid: 2147483646 }));
    const outcomes = await Promise.allSettled([acquireMarkerLock(lock), acquireMarkerLock(lock)]);
    const held = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(held).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { code: "host_operation_in_progress" },
    });
    const holder = JSON.parse(await readFile(lock, "utf8")) as { pid: number };
    expect(holder.pid).toBe(process.pid);
    await (held[0] as PromiseFulfilledResult<() => Promise<void>>).value();
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).sort()).toEqual([]);
  });

  it("never removes another holder's lock on release", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-marker-lock-"));
    roots.push(root);
    const lock = resolve(root, "marker.lock");
    const release = await acquireMarkerLock(lock);
    const other = lockContent({ pid: process.pid, token: "another-holder", createdAt: new Date() });
    await writeFile(lock, other);
    await release();
    expect(await readFile(lock, "utf8")).toBe(other);
  });
});

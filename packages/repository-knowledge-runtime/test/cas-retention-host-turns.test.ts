import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE,
  CAS_RETENTION_TURN_GRACE_MILLISECONDS as GRACE,
  finishRetentionTurn,
  requestRetentionTurn,
  returnRetentionTurn,
} from "../src/cas-retention-host-turns.js";

// ADR-0660: one retention slice per host per pause, the longest-waiting repository first.
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function host() {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-retention-turns-"));
  directories.push(directory);
  return {
    request: (repositoryRoot: string, now: number) =>
      requestRetentionTurn({ directory, repositoryRoot, now }),
    finish: (repositoryRoot: string, finishedAt: number, remaining: boolean) =>
      finishRetentionTurn({ directory, repositoryRoot, finishedAt, remaining }),
    giveBack: (repositoryRoot: string, previousSliceAt: number) =>
      returnRetentionTurn({ directory, repositoryRoot, previousSliceAt }),
  };
}

const T = Date.parse("2026-11-28T12:00:00.000Z");
const SLICE = 5_000;

it("serves three backlogged repositories in turn, each within three turns of its last", async () => {
  const { request, finish } = await host();
  // Each resident comes back exactly when told. C's first request is a full cycle's, deferred
  // while A's slice runs; its resident is armed for the moment the denial names.
  const next = new Map([
    ["/repo/a", T],
    ["/repo/b", T + 7_000],
    ["/repo/c", T + 10_000],
  ]);
  const grants: string[] = [];
  const grantTimes: number[] = [];
  while (grants.length < 15) {
    const [root, at] = [...next].sort((l, r) => l[1] - r[1] || l[0].localeCompare(r[0]))[0]!;
    const turn = await request(root, at);
    if (turn.granted) {
      grants.push(root.slice(-1));
      grantTimes.push(at);
      await finish(root, at + SLICE, true);
      next.set(root, at + SLICE + PAUSE);
    } else next.set(root, turn.retryAt);
  }
  // First come, first served: A asked again when its first slice ended, before B first asked.
  expect(grants.join("")).toBe("aabcabcabcabcab");
  // Every repository is served within three turns of its last, and its first within four.
  for (const repository of ["a", "b", "c"]) {
    const turns = grants.flatMap((grant, index) => (grant === repository ? [index] : []));
    expect(turns[0]).toBeLessThan(4);
    for (let index = 1; index < turns.length; index++)
      expect(turns[index]! - turns[index - 1]!).toBeLessThanOrEqual(3);
  }
  // One slice per pause for the whole host, never closer.
  for (let index = 1; index < grantTimes.length; index++)
    expect(grantTimes[index]! - grantTimes[index - 1]!).toBe(SLICE + PAUSE);
});

it("never lets a request whose owner did not come back block another", async () => {
  const { request, finish } = await host();
  expect(await request("/repo/a", T)).toMatchObject({ granted: true });
  // C is deferred while A runs; it is due back when A's pause ends, and then never returns.
  expect(await request("/repo/c", T + 1_000)).toEqual({ granted: false, retryAt: T + PAUSE });
  await finish("/repo/a", T + SLICE, true);
  // Within the grace C's place holds against A, which waited less long.
  expect(await request("/repo/a", T + SLICE + PAUSE)).toMatchObject({ granted: false });
  // Past it, C's request is withdrawn and A is served.
  expect(await request("/repo/a", T + PAUSE + GRACE + 1_000)).toMatchObject({ granted: true });
});

it("gives an unused turn back without moving the host's pause", async () => {
  const { request, giveBack, finish } = await host();
  const first = await request("/repo/a", T);
  expect(first).toEqual({ granted: true, previousSliceAt: 0 });
  await finish("/repo/a", T + SLICE, true);
  const second = await request("/repo/a", T + SLICE + PAUSE);
  expect(second).toEqual({ granted: true, previousSliceAt: T + SLICE });
  if (!second.granted) throw new Error("unreachable");
  await giveBack("/repo/a", second.previousSliceAt);
  // B is served at once: the returned turn left the pause where A's last slice put it.
  expect(await request("/repo/b", T + SLICE + PAUSE + 1)).toMatchObject({ granted: true });
});

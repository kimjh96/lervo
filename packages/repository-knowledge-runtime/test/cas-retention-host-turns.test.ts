import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE,
  finishRetentionTurn,
  requestRetentionTurn,
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
  const request = (repositoryRoot: string, now: number) =>
    requestRetentionTurn({ directory, repositoryRoot, pendingSince: now, now });
  const finish = (repositoryRoot: string, finishedAt: number, remaining: boolean) =>
    finishRetentionTurn({ directory, repositoryRoot, finishedAt, remaining });
  return { request, finish };
}

const T = Date.parse("2026-11-28T12:00:00.000Z");

it("starts at most one slice per host per pause and rotates across repositories", async () => {
  const { request, finish } = await host();
  expect(await request("/repo/a", T)).toEqual({ granted: true });
  // B asks while A's slice runs and again before the pause after it has passed.
  expect(await request("/repo/b", T + 1_000)).toEqual({ granted: false, retryAt: T + PAUSE });
  await finish("/repo/a", T + 5_000, true);
  expect(await request("/repo/b", T + 20_000)).toEqual({
    granted: false,
    retryAt: T + 5_000 + PAUSE,
  });
  // A finished with work left, so it queued again behind B, which waited longer.
  expect(await request("/repo/a", T + 5_000 + PAUSE)).toMatchObject({ granted: false });
  expect(await request("/repo/b", T + 5_000 + PAUSE)).toEqual({ granted: true });
  await finish("/repo/b", T + 40_000, false);
  expect(await request("/repo/a", T + 40_000 + PAUSE)).toEqual({ granted: true });
});

it("lets a request that stopped asking lose its turn, but not its place", async () => {
  const { request, finish } = await host();
  expect(await request("/repo/a", T)).toEqual({ granted: true });
  await finish("/repo/a", T, false);
  // C asks first, then backs off behind live work; B keeps asking.
  expect(await request("/repo/c", T + 1_000)).toMatchObject({ granted: false });
  expect(await request("/repo/b", T + 2_000)).toMatchObject({ granted: false });
  expect(await request("/repo/b", T + 3 * PAUSE)).toEqual({ granted: true });
  await finish("/repo/b", T + 3 * PAUSE, true);
  // Asking again, C keeps the place it took first, ahead of B.
  expect(await request("/repo/c", T + 5 * PAUSE)).toEqual({ granted: true });
  expect(await request("/repo/b", T + 5 * PAUSE + 1)).toMatchObject({ granted: false });
});

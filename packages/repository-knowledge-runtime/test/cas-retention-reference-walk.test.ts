import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { compactProjectConvergenceArtifacts } from "../src/cas-retention.js";
import * as files from "../src/cas-retention-files.js";
import { casTombstonePath } from "../src/cas-retention-tombstones.js";
import { finishRetention, retentionFixture } from "./cas-retention-fixture.js";

// ADR-0658: the reference walk names what stops it, skips byte-less pipes, and prunes with a
// tombstone that the CAS reports as pruned.
const fixtures: Awaited<ReturnType<typeof retentionFixture>>[] = [];
const locked: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of locked.splice(0)) await chmod(path, 0o700).catch(() => undefined);
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function fixture() {
  const f = await retentionFixture();
  fixtures.push(f);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  return f;
}

it("skips the event channel's pipes and prunes behind a tombstone the CAS reports as pruned", async () => {
  const f = await fixture();
  const { obsolete, kept } = await f.settled("pipes");
  const channel = resolve(f.storage.paths.lervoRoot, "run", "events.sqlite");
  await mkdir(channel, { recursive: true });
  execFileSync("mkfifo", [resolve(channel, "subscriber.fifo")]);
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    failure: null,
    removedObjects: 1,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
  expect(await f.artifacts.has(kept.uri)).toBe(true);
  const hash = obsolete.contentHash.slice(7);
  const tombstone = JSON.parse(
    await readFile(casTombstonePath(f.storage.paths.cas, hash), "utf8"),
  ) as { prunedAt: string; size: number; policy: string };
  expect(tombstone).toMatchObject({
    size: obsolete.byteCount,
    policy: "convergence_artifact_retention",
  });
  await expect(f.artifacts.get(obsolete.uri)).rejects.toMatchObject({ code: "pruned" });
});

it("names an unreadable directory relative to the repository and deletes nothing", async () => {
  if (process.getuid?.() === 0) return;
  const f = await fixture();
  const { obsolete } = await f.settled("unreadable");
  // Like the root-owned leftover on WSL; this fixture is no Git checkout, so its coordination
  // home already lives at .lervo/data/repository-coordination-v1.
  const leftover = resolve(f.storage.paths.data, "leftover-root-owned");
  await mkdir(resolve(leftover, "inner"), { recursive: true });
  await chmod(leftover, 0o000);
  locked.push(leftover);
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "unavailable",
    failure: "unreadable_reference",
    reference: ".lervo/data/leftover-root-owned",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("names a link in Lervo's state instead of an anonymous failure", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("link");
  await mkdir(f.storage.paths.knowledgeState, { recursive: true });
  await symlink("/etc/hosts", resolve(f.storage.paths.knowledgeState, "linked.json"));
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "unavailable",
    failure: "unsafe_reference",
    reference: ".lervo/state/knowledge/linked.json",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("never deletes an object that a file starts to name while the pass reads it", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("concurrent");
  const directory = resolve(f.storage.paths.knowledgeState, "concurrent");
  const writer = resolve(directory, "writer.json");
  await mkdir(directory, { recursive: true });
  await writeFile(writer, "{}");
  const scan = files.scanReferenceChunk;
  let wrote = false;
  vi.spyOn(files, "scanReferenceChunk").mockImplementation(async (file, ...rest) => {
    const read = await scan(file, ...rest);
    // After the writer's first read finished, it starts naming the candidate.
    if (!wrote && file.path === writer) {
      wrote = true;
      await writeFile(writer, JSON.stringify({ evidence: obsolete.uri }));
    }
    return read;
  });
  const result = await finishRetention(f.storage);
  expect(result).toMatchObject({ status: "collected", removedObjects: 0 });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("reports a file that keeps changing after three immediate rescans as unstable", async () => {
  const f = await fixture();
  await f.settled("unstable");
  const directory = resolve(f.storage.paths.knowledgeState, "unstable");
  const busy = resolve(directory, "busy.json");
  await mkdir(directory, { recursive: true });
  await writeFile(busy, "{}");
  const scan = files.scanReferenceChunk;
  let writes = 0;
  vi.spyOn(files, "scanReferenceChunk").mockImplementation(async (file, ...rest) => {
    if (file.path === busy) await writeFile(busy, JSON.stringify({ write: ++writes }));
    return scan(file, ...rest);
  });
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({
    status: "yielded",
    failure: "unstable_reference",
    reference: ".lervo/state/knowledge/unstable/busy.json",
    removedObjects: 0,
  });
  expect(writes).toBe(4);
});

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import type { OutboxStore } from "@lervo/storage-contract";
import { compactProjectConvergenceArtifacts } from "../src/cas-retention.js";
import * as files from "../src/cas-retention-files.js";
import { retentionFixture, finishRetention } from "./cas-retention-fixture.js";

// ADR-0584: a resident host keeps writing state while the collector scans it.
const fixtures: Awaited<ReturnType<typeof retentionFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function fixture() {
  const f = await retentionFixture();
  fixtures.push(f);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  return f;
}

it("completes a pass when yield probes are slow and state files change between cycles", async () => {
  const f = await fixture();
  const { obsolete, kept } = await f.settled("live");
  let now = Date.now();
  vi.mocked(Date.now).mockImplementation(() => now);
  // Each probe lists assignments and admission state. The old 100 ms deadline counted probes,
  // and a Mac host with 241 assignments read about six files per cycle.
  const probe = async () => {
    now += 20;
    return false;
  };
  const live = resolve(f.storage.paths.knowledgeState, "live");
  await mkdir(live, { recursive: true });
  let result: Awaited<ReturnType<typeof compactProjectConvergenceArtifacts>> = null;
  for (let cycle = 0; cycle < 16; cycle++) {
    for (let index = 0; index < 8; index++)
      await writeFile(
        resolve(live, `${index}.json`),
        JSON.stringify({ padding: "x".repeat(cycle) }),
      );
    result = await compactProjectConvergenceArtifacts(f.storage, probe);
    if (result?.status !== "yielded") break;
  }
  expect(result).toMatchObject({
    status: "collected",
    failure: null,
    removedObjects: 1,
    reclaimedBytes: obsolete.byteCount,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
  expect(await f.artifacts.has(kept.uri)).toBe(true);
});

it("restarts a reference file that changes or vanishes mid-scan and keeps the other progress", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("racing");
  const directory = resolve(f.storage.paths.knowledgeState, "racing");
  const changing = resolve(directory, "changing.json");
  const vanishing = resolve(directory, "vanishing.json");
  await mkdir(directory, { recursive: true });
  await writeFile(changing, "{}");
  await writeFile(vanishing, "{}");
  const scan = files.scanReferenceChunk;
  let raced = false;
  vi.spyOn(files, "scanReferenceChunk").mockImplementation(async (file, ...rest) => {
    if (!raced && file.path === changing) {
      raced = true;
      // The new body names the candidate, so the restarted scan must retain it.
      await writeFile(changing, JSON.stringify({ evidence: obsolete.uri }));
      await rm(vanishing);
    }
    return scan(file, ...rest);
  });
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({
    status: "yielded",
    failure: null,
    removedObjects: 0,
  });
  const saved = JSON.parse(
    await readFile(resolve(f.storage.paths.knowledgeState, files.CAS_RETENTION_SCAN), "utf8"),
  ) as { scan: { files: Record<string, { complete: boolean; tail: string }> } };
  const entries = Object.entries(saved.scan.files);
  expect(entries.some(([, entry]) => entry.complete)).toBe(true);
  for (const [key, entry] of entries) {
    expect([changing, vanishing]).not.toContain(key);
    if (entry.complete) expect(entry.tail).toBe("");
  }
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("keeps an exact snapshot when an event lands during the canonical replay", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("busy-writer");
  let appended = false;
  const list = f.storage.events.list.bind(f.storage.events);
  const events = {
    ...f.storage.events,
    list: (options: Parameters<OutboxStore["list"]>[0]) => {
      if (!appended && options?.types === undefined) {
        appended = true;
        f.event("other.subsystem.recorded", { evidenceHash: obsolete.contentHash });
      }
      return list(options);
    },
  } as OutboxStore;
  const storage = { ...f.storage, events };
  // The appended event roots the candidate; the head fence must stop this cycle's sweep.
  expect(await compactProjectConvergenceArtifacts(storage)).toMatchObject({
    status: "collected",
    failure: null,
    removedObjects: 0,
  });
  expect(await finishRetention(storage)).toMatchObject({
    status: "collected",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("names an exceeded collector bound without deleting anything", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("bound");
  await mkdir(f.storage.paths.knowledgeState, { recursive: true });
  const db = openSqliteDatabase(resolve(f.storage.paths.knowledgeState, "oversized.sqlite"), {
    busyTimeoutMs: 0,
  });
  db.exec("CREATE TABLE cells (body TEXT)");
  db.prepare("INSERT INTO cells VALUES (?)").run("x".repeat(1024 * 1024 + 1));
  db.close();
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "unavailable",
    failure: "bound_exceeded",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("skips macOS AppleDouble copies and reads a zero-byte SQLite file as an empty store", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("copied-from-mac");
  const data = f.storage.paths.data;
  // AppleDouble header: magic 00 05 16 07, version 00 02 00 00, then filler and entries.
  const appleDouble = Buffer.alloc(163);
  Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]).copy(appleDouble);
  await writeFile(resolve(data, "._events.sqlite"), appleDouble);
  await writeFile(resolve(data, "assignments.sqlite"), "");
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    failure: null,
    removedObjects: 1,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
});

it("still fails closed on an unreadable store, even one named like AppleDouble", async () => {
  for (const name of ["broken.sqlite", "._broken.sqlite"]) {
    const f = await fixture();
    const { obsolete } = await f.settled("unreadable");
    await writeFile(resolve(f.storage.paths.data, name), "not a database");
    expect(await finishRetention(f.storage)).toMatchObject({
      status: "unavailable",
      failure: "failed",
      removedObjects: 0,
    });
    expect(await f.artifacts.has(obsolete.uri)).toBe(true);
  }
});

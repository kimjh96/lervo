import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { compactProjectConvergenceArtifacts } from "../src/cas-retention.js";
import * as files from "../src/cas-retention-files.js";
import { retentionFixture, finishRetention } from "./cas-retention-fixture.js";

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

it("collects only old unreachable convergence artifacts, retaining open and latest settled event references", async () => {
  const f = await fixture();
  const { obsolete, kept } = await f.settled("old");
  const open = await f.put({ kind: "open" });
  const dependency = await f.put({ kind: "dependency" });
  f.event("repository.knowledge.baseline.requested", {
    obligationId: "open",
    inputArtifactHash: open.contentHash,
  });
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "open",
    stage: "assessment",
    state: "attention_required",
    dependencyHash: dependency.contentHash,
    evidenceHash: open.contentHash,
  });
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
    reclaimedBytes: obsolete.byteCount,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
  for (const artifact of [kept, open, dependency])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);
});

it("retains references from every other event, private CAS records, candidates, instruction capture, terminal evidence and journals", async () => {
  const f = await fixture();
  const cases = [];
  for (const label of [
    "event",
    "cas",
    "normalization",
    "canonicalization",
    "instruction",
    "terminal",
    "journal",
    "sqlite",
  ])
    cases.push({ label, ...(await f.settled(label)) });
  f.event("other.subsystem.recorded", { nested: { evidenceHash: cases[0]!.obsolete.contentHash } });
  await f.put({ subsystem: "archive", input: cases[1]!.obsolete.uri });
  for (const [index, path] of [
    "candidates/normalization.json",
    "candidates/canonicalization.json",
    "instruction-capture/queue.json",
    "terminal/evidence.json",
    "transactions/journal.json",
  ].entries()) {
    const target = resolve(f.storage.paths.knowledgeState, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, JSON.stringify({ reference: cases[index + 2]!.obsolete.uri }));
  }
  const db = openSqliteDatabase(resolve(f.storage.paths.knowledgeState, "checkpoints.sqlite"), {
    busyTimeoutMs: 0,
  });
  db.exec("CREATE TABLE checkpoints (body TEXT)");
  // Long cells exercise references in SQLite overflow pages, rather than physical byte scanning.
  db.prepare("INSERT INTO checkpoints VALUES (?)").run(
    JSON.stringify({ padding: "x".repeat(8192), inputHash: cases.at(-1)!.obsolete.contentHash }),
  );
  db.close();
  const result = await finishRetention(f.storage);
  expect(result?.status).toBe("collected");
  expect(result?.removedObjects).toBe(0);
  for (const item of cases) expect(await f.artifacts.has(item.obsolete.uri)).toBe(true);
});

it("honors the grace period and worker lock, and yields before touching live developer work", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("grace");
  const hash = obsolete.contentHash.slice(7);
  await utimes(
    resolve(f.storage.paths.cas, "sha256", hash.slice(0, 2), hash.slice(2)),
    new Date(),
    new Date(),
  );
  let release!: () => void;
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = withRepositoryKnowledgeWorkerLock(f.root, async () => {
    ready();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await acquired;
  try {
    expect(await compactProjectConvergenceArtifacts(f.storage)).toBeNull();
  } finally {
    release();
    await held;
  }
  expect(await compactProjectConvergenceArtifacts(f.storage, async () => true)).toMatchObject({
    status: "yielded",
    removedObjects: 0,
  });
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({ removedObjects: 0 });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("leaves only unreachable objects after a crash and safely resumes the remaining unlinks", async () => {
  const f = await fixture();
  const first = await f.settled("first");
  const second = await f.settled("second");
  const unlink = files.removeUnreachableCasObject;
  let attempts = 0;
  vi.spyOn(files, "removeUnreachableCasObject").mockImplementation(async (file) => {
    if (++attempts === 2) throw new Error("power loss");
    return unlink(file);
  });
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "unavailable",
    removedObjects: 1,
  });
  for (const item of [first, second]) expect(await f.artifacts.has(item.kept.uri)).toBe(true);
  vi.mocked(files.removeUnreachableCasObject).mockImplementation(unlink);
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
  });
  for (const item of [first, second]) expect(await f.artifacts.has(item.obsolete.uri)).toBe(false);
  expect(
    JSON.parse(
      await readFile(
        resolve(f.storage.paths.knowledgeState, files.CAS_RETENTION_OBSERVATION),
        "utf8",
      ),
    ),
  ).toMatchObject({ removedObjects: 1, reclaimedBytes: expect.any(Number) });
});

it("limits deletion to 32 objects and resumes the same reference scan on the next cycle", async () => {
  const f = await fixture();
  const artifacts = [];
  for (let index = 0; index < 40; index++) artifacts.push(await f.put({ index }));
  const final = await f.settled(
    "bounded",
    artifacts.map((artifact) => artifact.contentHash),
  );
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 32,
  });
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 9,
  });
  expect(await f.artifacts.has(final.kept.uri)).toBe(true);
});

it("finishes a bounded body scan before collecting and follows references across chunk boundaries", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("large-root");
  const target = `lervo-cas://sha256/${obsolete.contentHash.slice(7)}`;
  // Position the reference across a one-MiB read boundary; this retained object is not a candidate.
  await f.put({
    padding: "x".repeat(1024 * 1024 - 30),
    target,
    trailing: "y".repeat(8 * 1024 * 1024),
  });
  // A slow disk spends 400 ms per read, so a cycle's one-second read budget ends mid-scan.
  let now = Date.now();
  vi.mocked(Date.now).mockImplementation(() => now);
  const scan = files.scanReferenceChunk;
  vi.spyOn(files, "scanReferenceChunk").mockImplementation(async (...input) => {
    now += 400;
    return scan(...input);
  });
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({
    status: "yielded",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
  const second = await finishRetention(f.storage);
  expect(second).toMatchObject({ status: "collected", removedObjects: 0 });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("rechecks the canonical event head after the final filesystem observation and before unlink", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("head-fence");
  const unlink = files.removeUnreachableCasObject;
  vi.spyOn(files, "removeUnreachableCasObject").mockImplementation(async (file, isCurrent) => {
    f.event("other.subsystem.recorded", { evidenceHash: obsolete.contentHash });
    return unlink(file, isCurrent);
  });
  // ADR-0658: a moved head keeps the object and is recorded as a stall, not a failure.
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 0,
    stalledPasses: 1,
    stallCause: "event_head_changed",
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("resumes bounded SQLite-report reference reads and preserves their candidate artifacts", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("reports");
  const { sha256 } = await import("@lervo/repository-knowledge");
  const reports = new Map<string, Uint8Array>();
  for (let index = 0; index < 70; index++) {
    const bytes = Buffer.from(JSON.stringify({ index, evidenceHash: obsolete.contentHash }));
    const hash = sha256(bytes);
    reports.set(hash, bytes);
    f.event("context.report.recorded", { reportHash: hash });
  }
  const storage = {
    ...f.storage,
    events: {
      ...f.storage.events,
      reports: { getReport: (hash: string) => reports.get(hash) ?? null },
    },
  };
  expect(await compactProjectConvergenceArtifacts(storage)).toMatchObject({
    status: "yielded",
    removedObjects: 0,
  });
  expect(await finishRetention(storage)).toMatchObject({ status: "collected", removedObjects: 0 });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("replaces an interrupted collector projection without treating its partial bytes as subsystem roots", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("projection-crash");
  await mkdir(f.storage.paths.knowledgeState, { recursive: true });
  await writeFile(
    resolve(f.storage.paths.knowledgeState, `${files.CAS_RETENTION_SCAN}.next`),
    JSON.stringify({ eligible: [obsolete.contentHash] }),
  );
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
});

it("skips the event replay while nothing is eligible at an unchanged head (ADR-0597)", async () => {
  const f = await fixture();
  const inventory = vi.spyOn(files, "casReferenceFiles");
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({ removedObjects: 0 });
  const first = inventory.mock.calls.length;
  expect(first).toBeGreaterThan(0);
  const scan = JSON.parse(
    await readFile(resolve(f.storage.paths.knowledgeState, files.CAS_RETENTION_SCAN), "utf8"),
  ) as { scan: { idle?: { head: string | null } } };
  expect(scan.scan.idle).toMatchObject({ head: f.storage.events.latest()?.eventHash ?? null });
  // Same head, inside the recheck interval: no inventory and no replay.
  await compactProjectConvergenceArtifacts(f.storage);
  expect(inventory.mock.calls.length).toBe(first);
  // The grace horizon moves with time, so an unchanged head is rechecked after six hours.
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-25T06:00:00Z"));
  await compactProjectConvergenceArtifacts(f.storage);
  expect(inventory.mock.calls.length).toBeGreaterThan(first);
  // A new head ends the skip at once.
  const rechecked = inventory.mock.calls.length;
  await f.settled("new head");
  await compactProjectConvergenceArtifacts(f.storage);
  expect(inventory.mock.calls.length).toBeGreaterThan(rechecked);
});

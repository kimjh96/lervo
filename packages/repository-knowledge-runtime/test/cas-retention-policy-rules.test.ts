import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { settledCanonicalDispositions } from "../src/canonical-disposition-ledger.js";
import { planProjectConvergenceArtifactRetention } from "../src/cas-retention-plan.js";
import { readConvergenceStageArtifact } from "../src/convergence-stage-artifact.js";
import { finishRetention, retentionFixture } from "./cas-retention-fixture.js";

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

/** The CLI's `VACUUM INTO` copy keeps the live `events` columns; only rows matter here. */
async function writeBackup(
  f: Awaited<ReturnType<typeof retentionFixture>>,
  rows: readonly EventEnvelope[],
) {
  const directory = resolve(f.storage.paths.data, "event-writer-backups", "schema-8");
  await mkdir(directory, { recursive: true });
  const db = openSqliteDatabase(resolve(directory, "events.sqlite"), { busyTimeoutMs: 0 });
  try {
    db.exec(
      "CREATE TABLE events (event_id TEXT PRIMARY KEY, project_id TEXT, seq INTEGER, run_id TEXT, session_id TEXT, type TEXT, occurred_at TEXT, actor_json TEXT, schema_version INTEGER, policy_version TEXT, payload_json TEXT, previous_hash TEXT, event_hash TEXT)",
    );
    const insert = db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const event of rows)
      insert.run(
        event.eventId,
        event.projectId,
        event.seq,
        event.runId,
        event.sessionId,
        event.type,
        event.occurredAt,
        JSON.stringify(event.actor),
        event.schemaVersion,
        event.policyVersion,
        JSON.stringify(event.payload),
        event.previousHash,
        event.eventHash,
      );
  } finally {
    db.close();
  }
}

it("collects an object that only a mirrored event-writer backup names", async () => {
  const f = await fixture();
  const { obsolete, kept } = await f.settled("backup");
  await writeBackup(f, f.history);
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
    reclaimedBytes: obsolete.byteCount,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
  expect(await f.artifacts.has(kept.uri)).toBe(true);
});

it("keeps every object that a diverged or unknown backup event names", async () => {
  const f = await fixture();
  const diverged = await f.settled("diverged");
  const unknown = await f.settled("unknown");
  const mirrored = await f.settled("mirrored");
  const rows = f.history.map((event) =>
    event.payload.obligationId === "diverged"
      ? { ...event, payload: { ...event.payload, rewritten: true } }
      : event,
  );
  const extra = {
    ...f.history.at(-1)!,
    eventId: `evt_${"f".repeat(32)}`,
    seq: f.history.length + 1,
    payload: { inputArtifactHash: unknown.obsolete.contentHash },
  };
  await writeBackup(f, [...rows, extra]);
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
  });
  expect(await f.artifacts.has(diverged.obsolete.uri)).toBe(true);
  expect(await f.artifacts.has(unknown.obsolete.uri)).toBe(true);
  expect(await f.artifacts.has(mirrored.obsolete.uri)).toBe(false);
});

it("collects a settled, archived assignment input, keeping open, latest and integrated inputs", async () => {
  const f = await fixture();
  const archived = await f.put({ stage: "archived" });
  const integrated = await f.put({ stage: "integrated" });
  const latest = await f.put({ stage: "latest" });
  const open = await f.put({ stage: "open" });
  const assignment = (id: string, obligation: string, input: string) =>
    f.event("assignment.created", {
      assignmentId: id,
      convergenceObligationId: obligation,
      convergenceInputArtifactHash: input,
    });
  f.event("repository.knowledge.baseline.requested", { obligationId: "settled" });
  assignment("asn_archived", "settled", archived.contentHash);
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "settled",
    stage: "assessment",
    state: "current",
    inputArtifactHash: archived.contentHash,
  });
  // Later stages always follow canonical integration; the ledger still replays its input.
  assignment("asn_integrated", "settled", integrated.contentHash);
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "settled",
    stage: "canonical_integration",
    state: "current",
    inputArtifactHash: integrated.contentHash,
  });
  assignment("asn_latest", "settled", latest.contentHash);
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "settled",
    stage: "lifecycle_verification",
    state: "current",
    inputArtifactHash: latest.contentHash,
  });
  f.event("repository.knowledge.convergence.recorded", {
    obligationId: "settled",
    terminalState: "current",
  });
  const archive = await f.put({
    assignmentId: "asn_archived",
    convergence: { obligationId: "settled", inputArtifactHash: archived.contentHash },
  });
  f.event("assignment.convergence.archived", {
    assignmentId: "asn_archived",
    obligationId: "settled",
    archiveArtifactHash: archive.contentHash,
  });
  f.event("repository.knowledge.baseline.requested", { obligationId: "open" });
  assignment("asn_open", "open", open.contentHash);
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "open",
    stage: "assessment",
    state: "current",
    inputArtifactHash: open.contentHash,
  });
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "open",
    stage: "canonical_review",
    state: "attention_required",
  });

  const plan = await planProjectConvergenceArtifactRetention(f.storage, new Date("2026-11-18"));
  expect(plan).toMatchObject({
    status: "planned",
    candidates: { objects: 4 },
    collectable: {
      objects: 1,
      bytes: archived.byteCount,
      byReason: { assignment_input: { objects: 1 }, unreferenced: { objects: 0 } },
    },
  });
  expect(await f.artifacts.has(archived.uri)).toBe(true);

  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 1,
  });
  expect(await f.artifacts.has(archived.uri)).toBe(false);
  for (const artifact of [latest, integrated, open, archive])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);
  // A reader of the pruned input reports its absence instead of throwing.
  expect(await readConvergenceStageArtifact(f.artifacts, archived.contentHash)).toEqual({
    state: "input_unavailable",
  });
  expect(await readConvergenceStageArtifact(f.artifacts, latest.contentHash)).toMatchObject({
    state: "available",
  });
});

it("plans backup and assignment releases read-only, per reason", async () => {
  const f = await fixture();
  const backup = await f.settled("plan-backup");
  const plain = await f.settled("plan-plain");
  await writeBackup(
    f,
    f.history.filter((event) => event.payload.obligationId === "plan-backup"),
  );
  const plan = await planProjectConvergenceArtifactRetention(f.storage, new Date("2026-11-18"));
  expect(plan.collectable).toMatchObject({
    objects: 2,
    bytes: backup.obsolete.byteCount + plain.obsolete.byteCount,
    byReason: {
      unreferenced: { objects: 1, bytes: plain.obsolete.byteCount },
      event_writer_backup: { objects: 1, bytes: backup.obsolete.byteCount },
      assignment_input: { objects: 0 },
      backup_and_assignment_input: { objects: 0 },
    },
  });
  expect(JSON.stringify(plan)).not.toContain(backup.obsolete.contentHash.slice(7));
  for (const artifact of [backup.obsolete, plain.obsolete])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);
});

it("retries a transient stage artifact read instead of caching it as a state", async () => {
  const f = await fixture();
  const ledger = {
    repositoryRoot: f.root,
    events: f.storage.events,
    projectId: f.storage.manifest.projectId,
    policyHash: sha256("policy"),
    sources: [],
  };
  const fail = (code: string) =>
    ({
      get: async () => {
        throw Object.assign(new Error(code), { code });
      },
    }) as unknown as ArtifactStore;
  await expect(
    settledCanonicalDispositions({ ...ledger, artifacts: f.artifacts }),
  ).resolves.toEqual([]);
  const input = sha256("pruned stage input");
  f.event("repository.knowledge.baseline.requested", { obligationId: "transient" });
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "transient",
    stage: "canonical_integration",
    state: "current",
    inputArtifactHash: input,
  });
  await expect(settledCanonicalDispositions({ ...ledger, artifacts: fail("EIO") })).rejects.toThrow(
    "EIO",
  );
  const get = vi.fn((uri: string) => f.artifacts.get(uri));
  await expect(
    settledCanonicalDispositions({ ...ledger, artifacts: { get } as unknown as ArtifactStore }),
  ).resolves.toEqual([]);
  expect(get).toHaveBeenCalledWith(`lervo-cas://sha256/${input.slice(7)}`);
  expect(await readConvergenceStageArtifact(fail("corrupt_object"), input)).toEqual({
    state: "invalid",
  });
  expect(await readConvergenceStageArtifact(f.artifacts, input)).toEqual({
    state: "input_unavailable",
  });
});

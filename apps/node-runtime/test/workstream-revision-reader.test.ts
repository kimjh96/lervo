import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FileSystemCas } from "@lervo/cas";
import { canonicalJson } from "@lervo/event-contract";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeWorkstreamReplicationLocalPort } from "../src/workstream-replication.js";
import {
  nodeRuntimeFixture,
  nodeRuntimeProjectId,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";
import { sqliteRows } from "../src/sqlite-row.js";

const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await removeTemporaryRoots();
});

async function fixture() {
  const root = await temporaryRoot();
  const paths = await nodeRuntimeFixture(root, 1);
  const events = await SQLiteEventStore.open({
    path: paths.databasePath,
    projectId: nodeRuntimeProjectId,
  });
  stores.push(events);
  const casRoot = resolve(paths.repositoryRoot, ".lervo/data/cas");
  const artifacts = await FileSystemCas.open(casRoot);
  const projection = resolve(paths.repositoryRoot, ".lervo/state/workstreams/current.json");
  await mkdir(resolve(projection, ".."), { recursive: true });
  let parent: string | null = null;
  let revision = 0;
  const append = async (options?: {
    completed?: boolean;
    nextGoal?: boolean;
    invalidOrigin?: boolean;
  }) => {
    if (options?.nextGoal) revision = 0;
    revision += 1;
    const snapshot: WorkstreamSnapshot = {
      schemaVersion: 1,
      workstreamId: options?.nextGoal
        ? "wks_abcdefabcdefabcdefabcdef"
        : "wks_1234567890abcdef12345678",
      revision,
      status: options?.completed ? "completed" : "active",
      title: "Incremental replication",
      objective: "Verify bounded workstream history reads.",
      nextActions: ["Continue verification."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      origin: options?.nextGoal
        ? {
            kind: "successor",
            sourceArtifactId: null,
            sourceContentHash: null,
            sourcePathDigest: null,
            predecessorWorkstreamId: "wks_1234567890abcdef12345678",
            predecessorSnapshotContentHash: options.invalidOrigin
              ? `sha256:${"f".repeat(64)}`
              : parent!,
          }
        : {
            kind: "created",
            sourceArtifactId: null,
            sourceContentHash: null,
            sourcePathDigest: null,
          },
      updatedAt: "2026-09-11T00:00:00.000Z",
    };
    const content = `${canonicalJson(snapshot)}\n`;
    const artifact = await artifacts.put(content);
    events.append({
      eventId: `evt_workstream_read_${options?.nextGoal ? "next_" : ""}${revision}`,
      projectId: nodeRuntimeProjectId,
      runId: "run_workstream_read_01",
      sessionId: "ses_workstream_read_01",
      type: "workstream.snapshot.recorded",
      occurredAt: snapshot.updatedAt,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: snapshot.workstreamId,
        revision,
        status: snapshot.status,
        changeKind: revision === 1 ? "agent_start" : "agent_update",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: parent,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: snapshot.updatedAt,
      },
    });
    parent = artifact.contentHash;
    await writeFile(projection, content);
    return resolve(casRoot, "sha256", parent.slice(7, 9), parent.slice(9));
  };
  const open = () =>
    new NodeWorkstreamReplicationLocalPort(
      paths.repositoryRoot,
      nodeRuntimeProjectId,
      events,
      artifacts,
      () => new Date(0),
    );
  return { ...paths, events, artifacts, projection, append, reader: open(), open };
}

describe("incremental workstream verification", () => {
  it("retains a completed goal before its exact successor and rejects forged successor origins", async () => {
    const valid = await fixture();
    await valid.append({ completed: true });
    await valid.append({ nextGoal: true });
    expect((await valid.reader.readRevisionChain()).map((item) => item.snapshot.status)).toEqual([
      "completed",
      "active",
    ]);

    const forged = await fixture();
    await forged.append({ completed: true });
    await forged.append({ nextGoal: true, invalidOrigin: true });
    await expect(forged.reader.readRevisionChain()).rejects.toThrow("ancestry is invalid");
  });

  it("keeps the selected review chain valid when another bound goal records an event", async () => {
    const f = await fixture();
    await f.append({ completed: true });
    await f.append({ nextGoal: true });
    const selected = JSON.parse(await readFile(f.projection, "utf8")) as WorkstreamSnapshot;
    const selectedContentHash = (await f.artifacts.put(`${canonicalJson(selected)}\n`)).contentHash;
    const bound = {
      ...selected,
      workstreamId: `wks_${"c".repeat(24)}`,
      title: "Parallel supervised goal",
      origin: {
        kind: "successor" as const,
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
        predecessorWorkstreamId: selected.workstreamId,
        predecessorSnapshotContentHash: selectedContentHash,
      },
    };
    const artifact = await f.artifacts.put(`${canonicalJson(bound)}\n`);
    f.events.append({
      eventId: `evt_${"c".repeat(32)}`,
      projectId: nodeRuntimeProjectId,
      runId: `run_${"c".repeat(32)}`,
      sessionId: `ses_${"c".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      occurredAt: bound.updatedAt,
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 1,
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: bound.workstreamId,
        revision: 1,
        status: bound.status,
        changeKind: "agent_start",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: selectedContentHash,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: bound.updatedAt,
      },
    });
    expect((await f.reader.readRevisionChain()).map((item) => item.snapshot.workstreamId)).toEqual([
      "wks_1234567890abcdef12345678",
      selected.workstreamId,
    ]);
    expect(JSON.parse(await readFile(f.projection, "utf8"))).toEqual(selected);
  });

  it("replicates the default-branch lineage whatever the checkout projects", async () => {
    const f = await fixture();
    await f.append();
    await f.append();
    const repositoryWide = JSON.parse(await readFile(f.projection, "utf8")) as WorkstreamSnapshot;
    await writeFile(
      resolve(f.projection, "../bindings.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        defaultBranch: "main",
        bindings: { main: repositoryWide.workstreamId, feature: `wks_${"d".repeat(24)}` },
      })}\n`,
    );
    const expected = [1, 2];

    // An unbound branch clears the projection.
    await unlink(f.projection);
    expect((await f.reader.readRevisionChain()).map((item) => item.snapshot.revision)).toEqual(
      expected,
    );

    // A feature branch projects its own unrelated workstream.
    const feature: WorkstreamSnapshot = {
      ...repositoryWide,
      workstreamId: `wks_${"d".repeat(24)}`,
      revision: 1,
      title: "Feature branch work",
    };
    const content = `${canonicalJson(feature)}\n`;
    const artifact = await f.artifacts.put(content);
    f.events.append({
      eventId: `evt_${"d".repeat(32)}`,
      projectId: nodeRuntimeProjectId,
      runId: `run_${"d".repeat(32)}`,
      sessionId: `ses_${"d".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      occurredAt: feature.updatedAt,
      actor: { kind: "agent", provider: "claude" },
      schemaVersion: 1,
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: feature.workstreamId,
        revision: 1,
        status: feature.status,
        changeKind: "agent_start",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: null,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: feature.updatedAt,
      },
    });
    await writeFile(f.projection, content);
    const chain = await f.reader.readRevisionChain();
    expect(chain.map((item) => item.snapshot.workstreamId)).toEqual([
      repositoryWide.workstreamId,
      repositoryWide.workstreamId,
    ]);
    expect(chain.map((item) => item.snapshot.revision)).toEqual(expected);
  });

  it("reads each new artifact once, skips unchanged ancestry, and rebuilds after restart", async () => {
    const f = await fixture();
    for (let i = 0; i < 12; i += 1) await f.append();
    const get = vi.spyOn(f.artifacts, "get");
    const has = vi.spyOn(f.artifacts, "has");
    const list = vi.spyOn(f.events, "list");
    const first = await f.reader.readRevisionChain();
    expect(first).toHaveLength(12);
    expect(get).toHaveBeenCalledTimes(12);
    expect(has).not.toHaveBeenCalled();
    get.mockClear();
    list.mockClear();
    first[0]!.snapshot.title = "Caller mutation must not poison the cache";
    expect((await f.reader.readRevisionChain())[0]!.snapshot.title).toBe("Incremental replication");
    expect(get).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ afterSeq: 13, limit: 1_000 });
    await f.append();
    get.mockClear();
    expect(await f.reader.readRevisionChain()).toHaveLength(13);
    expect(get).toHaveBeenCalledTimes(1);
    get.mockClear();
    const restarted = new NodeWorkstreamReplicationLocalPort(
      f.repositoryRoot,
      nodeRuntimeProjectId,
      f.events,
      f.artifacts,
    );
    expect(await restarted.readRevisionChain()).toHaveLength(13);
    expect(get).toHaveBeenCalledTimes(13);
  });

  it.each(["corrupt", "missing"])(
    "detects an old %s object when a reader next opens and keeps failing closed (ADR-0602)",
    async (failure) => {
      const f = await fixture();
      const old = await f.append();
      await f.append();
      await f.reader.readRevisionChain();
      const original = await readFile(old);
      if (failure === "missing") await unlink(old);
      else await writeFile(old, "corrupt");
      // The open reader already proved that object and does not re-read it.
      expect(await f.reader.readRevisionChain()).toHaveLength(2);
      const reopened = f.open();
      await expect(reopened.readRevisionChain()).rejects.toThrow();
      await expect(reopened.readRevisionChain()).rejects.toThrow();
      await writeFile(old, original);
      expect(await reopened.readRevisionChain()).toHaveLength(2);
    },
  );

  it("re-reads no history and no artifact across any number of idle reads (ADR-0602)", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i += 1) await f.append();
    await f.reader.readRevisionChain();
    const get = vi.spyOn(f.artifacts, "get");
    const list = vi.spyOn(f.events, "list");
    // An idle Node service may read the chain many times; a day of reads every ten minutes.
    for (let read = 0; read < 144; read += 1)
      expect(await f.reader.readRevisionChain()).toHaveLength(5);
    expect(get).not.toHaveBeenCalled();
    expect(list.mock.calls.every(([options]) => (options?.afterSeq ?? 0) > 0)).toBe(true);
    // A newly opened reader still re-proves history from the first event.
    expect(await f.open().readRevisionChain()).toHaveLength(5);
    expect(list.mock.calls.some(([options]) => (options?.afterSeq ?? 0) === 0)).toBe(true);
    expect(get).toHaveBeenCalledTimes(5);
  });

  it("re-proves the exact revisions before they are published (ADR-0602)", async () => {
    const f = await fixture();
    await f.append();
    const last = await f.append();
    const revisions = await f.reader.readRevisionChain();
    await expect(f.reader.verifyForPublish(revisions)).resolves.toBeUndefined();
    // A snapshot artifact removed after it was verified is caught before it would be sent.
    const original = await readFile(last);
    await unlink(last);
    await expect(f.reader.verifyForPublish(revisions)).rejects.toThrow();
    await writeFile(last, original);
    // A recording event rewritten after it was verified is caught as well.
    const revisionsAgain = await f.reader.readRevisionChain();
    const db = new DatabaseSync(f.databasePath);
    try {
      for (const row of sqliteRows(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'")
          .all(),
      ))
        db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
      db.prepare("UPDATE events SET event_hash = ? WHERE seq = (SELECT max(seq) FROM events)").run(
        `sha256:${"e".repeat(64)}`,
      );
    } finally {
      db.close();
    }
    await expect(f.reader.verifyForPublish(revisionsAgain)).rejects.toThrow();
  });

  it("rejects a missing or altered current projection even with a cached head", async () => {
    const f = await fixture();
    await f.append();
    await f.reader.readRevisionChain();
    const original = await readFile(f.projection);
    await unlink(f.projection);
    await expect(f.reader.readRevisionChain()).rejects.toThrow("projection is missing");
    await writeFile(f.projection, original);
    await f.reader.readRevisionChain();
    const changed = JSON.parse(original.toString());
    changed.title = "Altered projection";
    await writeFile(f.projection, `${canonicalJson(changed)}\n`);
    await expect(f.reader.readRevisionChain()).rejects.toThrow("differs from its latest event");
  });

  it("rejects database replacement without serving the old connection's cached history", async () => {
    const f = await fixture();
    await f.append();
    await f.reader.readRevisionChain();
    await rename(f.databasePath, `${f.databasePath}.old`);
    await writeFile(f.databasePath, "replacement");
    await expect(f.reader.readRevisionChain()).rejects.toThrow("database was replaced");
  });

  it("rejects an altered historical event when a reader next opens (ADR-0602)", async () => {
    const f = await fixture();
    await f.append();
    await f.append();
    await f.reader.readRevisionChain();
    const db = new DatabaseSync(f.databasePath);
    try {
      const triggers = sqliteRows(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'")
          .all(),
      );
      for (const row of triggers)
        db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
      db.prepare("UPDATE events SET previous_hash = ? WHERE seq = 2").run(
        `sha256:${"f".repeat(64)}`,
      );
    } finally {
      db.close();
    }
    // The store rejects the altered row when a newly opened reader verifies from the first event.
    await expect(f.open().readRevisionChain()).rejects.toMatchObject({ code: "integrity_failed" });
  });
});

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
  const append = async () => {
    revision += 1;
    const snapshot: WorkstreamSnapshot = {
      schemaVersion: 1,
      workstreamId: "wks_1234567890abcdef12345678",
      revision,
      status: "active",
      title: "Incremental replication",
      objective: "Verify bounded workstream history reads.",
      nextActions: ["Continue verification."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      origin: {
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
      eventId: `evt_workstream_read_${revision}`,
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
  let now = 0;
  const reader = new NodeWorkstreamReplicationLocalPort(
    paths.repositoryRoot,
    nodeRuntimeProjectId,
    events,
    artifacts,
    () => new Date(now),
  );
  return {
    ...paths,
    events,
    artifacts,
    projection,
    append,
    reader,
    setTime: (value: number) => {
      now = value;
    },
  };
}

describe("incremental workstream verification", () => {
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
    "detects an old %s object at the next audit and keeps failing closed",
    async (failure) => {
      const f = await fixture();
      const old = await f.append();
      await f.append();
      await f.reader.readRevisionChain();
      const original = await readFile(old);
      if (failure === "missing") await unlink(old);
      else await writeFile(old, "corrupt");
      expect(await f.reader.readRevisionChain()).toHaveLength(2);
      f.setTime(60_000);
      await expect(f.reader.readRevisionChain()).rejects.toThrow();
      await expect(f.reader.readRevisionChain()).rejects.toThrow();
      await writeFile(old, original);
      expect(await f.reader.readRevisionChain()).toHaveLength(2);
    },
  );

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

  it("rejects an altered historical event during the scheduled audit", async () => {
    const f = await fixture();
    await f.append();
    await f.append();
    await f.reader.readRevisionChain();
    const db = new DatabaseSync(f.databasePath);
    try {
      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'")
        .all();
      for (const row of triggers)
        db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
      db.prepare("UPDATE events SET previous_hash = ? WHERE seq = 2").run(
        `sha256:${"f".repeat(64)}`,
      );
    } finally {
      db.close();
    }
    f.setTime(60_000);
    await expect(f.reader.readRevisionChain()).rejects.toThrow("event chain is invalid");
  });
});

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeEventHash,
  inspectExistingEventStore,
  type EventDraft,
  type EventDraftV1,
  SQLiteEventStore,
} from "../src/index.js";
import { sqliteRow } from "../src/sqlite-row.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-events-"));
  temporaryRoots.push(root);
  return resolve(root, "state/events.sqlite");
}

function draft(overrides: Partial<EventDraftV1> = {}): EventDraftV1 {
  return {
    eventId: "evt_01234567",
    projectId,
    runId: "run_01234567",
    sessionId: "ses_01234567",
    type: "run.requested",
    occurredAt: "2026-08-18T00:00:00Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      role: "developer",
      rawPrompt: "source text that must not be stored",
    },
    ...overrides,
  };
}

function causalDraft(input: { eventId: string; runId: string }): EventDraft {
  return {
    eventId: input.eventId,
    projectId,
    runId: input.runId,
    sessionId: `ses_${input.runId.slice(4)}_causal`,
    type: "work.causality.recorded",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion,
    payload: {
      workId: `wrk_${"c".repeat(24)}`,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite append-only event store", () => {
  it("reads mixed maintenance history after writer rollback and rejects schema 5 on a schema-4 writer", async () => {
    const path = await databasePath();
    const maintenance: EventDraft = {
      ...draft(),
      eventId: "evt_maintenance_receipt",
      schemaVersion: 5,
      type: "document.freshness.assessment.recorded",
      payload: {
        projectId,
        findingDigest: policyVersion,
        documentHash: policyVersion,
        evidenceContractHash: policyVersion,
        receiptHash: policyVersion,
        occurredAt: "2026-10-08T01:00:00Z",
        outcome: "verified_no_change",
        dependencyDigest: policyVersion,
        verificationContractHash: policyVersion,
      },
    };
    let store = await SQLiteEventStore.open({ path, projectId, writableEventSchemaVersion: 4 });
    store.append(draft());
    expect(() => store.append(maintenance)).toThrowError(
      expect.objectContaining({ code: "event_schema_unsupported" }),
    );
    store.close();
    store = await SQLiteEventStore.open({ path, projectId, writableEventSchemaVersion: 5 });
    store.append(maintenance);
    store.close();
    store = await SQLiteEventStore.open({ path, projectId, writableEventSchemaVersion: 1 });
    expect(store.list().map((event) => event.schemaVersion)).toEqual([1, 5]);
    expect(store.verifyIntegrity().valid).toBe(true);
    store.close();
  });
  it("enforces one immutable causal event per run and one root per work", async () => {
    const store = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId,
      writableEventSchemaVersion: 2,
    });
    store.append(causalDraft({ eventId: "evt_causal_root_0001", runId: "run_causal_root_0001" }));
    expect(() =>
      store.append(causalDraft({ eventId: "evt_causal_root_0002", runId: "run_causal_root_0001" })),
    ).toThrow();
    expect(() =>
      store.append(causalDraft({ eventId: "evt_causal_root_0003", runId: "run_causal_root_0002" })),
    ).toThrow();
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("uses WAL and assigns one project-wide sequence and hash chain", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });

    const first = store.append(draft());
    const second = store.append(
      draft({
        eventId: "evt_12345678",
        runId: "run_12345678",
        sessionId: "ses_12345678",
        occurredAt: "2026-08-18T00:00:01Z",
      }),
    );

    expect(store.journalMode()).toBe("wal");
    expect(first.event.seq).toBe(1);
    expect(first.event.previousHash).toBeNull();
    expect(second.event.seq).toBe(2);
    expect(second.event.previousHash).toBe(first.event.eventHash);
    expect(store.latest()).toEqual(second.event);
    const { eventHash: _eventHash, ...secondWithoutHash } = second.event;
    expect(second.event.eventHash).toBe(computeEventHash(secondWithoutHash));
    expect(store.verifyIntegrity()).toEqual({
      valid: true,
      eventCount: 2,
      headHash: second.event.eventHash,
    });
    store.close();
  });

  it("stores only allowlisted payload fields", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });

    const result = store.append(draft());

    expect(result.event.payload).toEqual({
      requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      role: "developer",
    });
    expect(result.redactions).toContainEqual({
      path: "$.rawPrompt",
      reason: "not_allowlisted",
    });
    expect(JSON.stringify(store.get(result.event.eventId))).not.toContain(
      "source text that must not be stored",
    );
    store.close();
  });

  it("never passes a nested camelCase secret across the SQLite boundary", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    const result = store.append(
      draft({
        type: "adapter.started",
        payload: {
          adapterId: "lervo/claude",
          adapterVersion: "1",
          providerSessionId: "provider-session-1",
          capabilities: { toolCalls: "supported", accessToken: "secret-must-not-persist" },
        },
      }),
    );

    expect(result.event.payload).toEqual({
      adapterId: "lervo/claude",
      adapterVersion: "1",
      providerSessionId: "provider-session-1",
      capabilities: { toolCalls: "supported" },
    });
    store.close();
    expect((await readFile(path)).includes(Buffer.from("secret-must-not-persist"))).toBe(false);
  });

  it("is idempotent for the same event and rejects the same id with different content", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });

    const first = store.append(draft());
    const repeated = store.append(draft());

    expect(repeated.inserted).toBe(false);
    expect(repeated.event).toEqual(first.event);
    expect(() =>
      store.append(
        draft({
          payload: {
            requestDigest:
              "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "event_id_conflict" }));
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("rolls back an invalid append without consuming a sequence", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });

    expect(() => store.append(draft({ eventId: "invalid" }))).toThrowError(
      expect.objectContaining({ code: "invalid_event" }),
    );
    const valid = store.append(draft());

    expect(valid.event.seq).toBe(1);
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("keeps the production writer on envelope version 1", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    expect(() =>
      store.append({ ...draft(), schemaVersion: 2 } as unknown as EventDraft),
    ).toThrowError(expect.objectContaining({ code: "event_schema_unsupported" }));
    expect(store.list()).toEqual([]);
    store.close();
  });

  it("upgrades existing common drafts to the explicitly selected version 2", async () => {
    const store = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId,
      writableEventSchemaVersion: 2,
    });

    const result = store.append(draft());
    expect(result.event.schemaVersion).toBe(2);
    expect(store.append(draft())).toMatchObject({ inserted: false, event: result.event });
    expect(store.verifyIntegrity()).toMatchObject({ valid: true, eventCount: 1 });
    store.close();
  });

  it("keeps an existing version 1 event idempotent across writer activation", async () => {
    const path = await databasePath();
    const before = await SQLiteEventStore.open({ path, projectId });
    const original = before.append(draft()).event;
    before.close();

    const activated = await SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 2,
    });
    expect(activated.append(draft())).toMatchObject({ inserted: false, event: original });
    const next = activated.append(
      draft({
        eventId: "evt_12345678",
        occurredAt: "2026-08-18T00:00:01Z",
      }),
    );
    expect(next.event.schemaVersion).toBe(2);
    expect(next.event.previousHash).toBe(original.eventHash);
    activated.close();
  });

  it("rolls back every event in a failed unit of work", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });

    expect(() =>
      store.transact((transaction) => {
        transaction.append(draft());
        transaction.append(draft({ eventId: "invalid" }));
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_event" }));

    expect(store.list()).toEqual([]);
    expect(store.append(draft()).event.seq).toBe(1);
    store.close();
  });

  it("rejects async and nested transaction callbacks before commit", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });

    expect(() => store.transact(async (transaction) => transaction.append(draft()))).toThrowError(
      expect.objectContaining({ code: "transaction_async" }),
    );
    expect(() => store.transact(() => store.transact(() => undefined))).toThrowError(
      expect.objectContaining({ code: "nested_transaction" }),
    );
    expect(store.list()).toEqual([]);
    store.close();
  });

  it("serializes appends from two store connections without duplicate sequences", async () => {
    const path = await databasePath();
    const first = await SQLiteEventStore.open({ path, projectId });
    const second = await SQLiteEventStore.open({ path, projectId });

    expect(first.append(draft()).event.seq).toBe(1);
    expect(
      second.append(draft({ eventId: "evt_12345678", occurredAt: "2026-08-18T00:00:01Z" })).event
        .seq,
    ).toBe(2);
    expect(first.verifyIntegrity().eventCount).toBe(2);
    first.close();
    second.close();
  });

  it("verifies integrity across bounded event pages", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    let headHash: string | null = null;
    for (let index = 1; index <= 1001; index += 1) {
      headHash = store.append(
        draft({
          eventId: `evt_${String(index).padStart(8, "0")}`,
          occurredAt: `2026-08-18T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
        }),
      ).event.eventHash;
    }

    expect(store.verifyIntegrity()).toEqual({ valid: true, eventCount: 1001, headHash });
    store.close();
  });

  it("records and validates the explicit schema migration version", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    store.close();
    const raw = new DatabaseSync(path);
    expect(sqliteRow(raw.prepare("PRAGMA user_version;").get())?.user_version).toBe(3);
    raw.close();
  });

  it("inspects an existing chain through a temporary copy without touching the source", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    const event = store.append(draft()).event;
    store.close();
    const before = await readFile(path);

    await expect(inspectExistingEventStore({ path, projectId })).resolves.toEqual({
      eventCount: 1,
      headHash: event.eventHash,
      storageSchemaVersion: 3,
      requiresSchemaMigration: false,
    });

    expect(await readFile(path)).toEqual(before);
    await expect(access(`${path}-wal`)).rejects.toThrow();
    await expect(access(`${path}-shm`)).rejects.toThrow();
  });

  it("recovers the committed chain after close and reopen", async () => {
    const path = await databasePath();
    const firstStore = await SQLiteEventStore.open({ path, projectId });
    const first = firstStore.append(draft());
    firstStore.close();

    const reopened = await SQLiteEventStore.open({ path, projectId });
    expect(reopened.get(first.event.eventId)).toEqual(first.event);
    const second = reopened.append(
      draft({ eventId: "evt_12345678", occurredAt: "2026-08-18T00:00:01Z" }),
    );
    expect(second.event.seq).toBe(2);
    expect(second.event.previousHash).toBe(first.event.eventHash);
    reopened.close();
  });

  it("does not expose an uncommitted raw SQLite transaction after restart", async () => {
    const path = await databasePath();
    const initialized = await SQLiteEventStore.open({ path, projectId });
    initialized.close();

    const raw = new DatabaseSync(path);
    raw.exec("BEGIN IMMEDIATE;");
    raw
      .prepare(
        `
      INSERT INTO events (
        event_id, project_id, seq, run_id, session_id, type, occurred_at,
        actor_json, schema_version, policy_version, payload_json,
        previous_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "evt_99999999",
        projectId,
        1,
        "run_01234567",
        "ses_01234567",
        "run.requested",
        "2026-08-18T00:00:00Z",
        '{"kind":"user"}',
        1,
        policyVersion,
        "{}",
        null,
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      );
    raw.close();

    const reopened = await SQLiteEventStore.open({ path, projectId });
    expect(reopened.list()).toEqual([]);
    reopened.close();
  });

  it("rolls back an uncommitted transaction after the writer is killed", async () => {
    const path = await databasePath();
    const initialized = await SQLiteEventStore.open({ path, projectId });
    initialized.close();

    const script = `
      import { DatabaseSync } from "node:sqlite";
      const database = new DatabaseSync(process.argv[1]);
      database.exec("BEGIN IMMEDIATE;");
      database.prepare("INSERT INTO events (event_id, project_id, seq, run_id, session_id, type, occurred_at, actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("evt_99999999", process.argv[2], 1, "run_01234567", "ses_01234567", "run.requested", "2026-08-18T00:00:00Z", '{"kind":"user"}', 1, process.argv[3], '{}', null, "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
      process.stdout.write("READY\\n");
      setInterval(() => {}, 10_000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, path, projectId, policyVersion],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(
          () => rejectReady(new Error("writer child did not become ready")),
          2_000,
        );
        const settle = (callback: () => void) => {
          clearTimeout(timer);
          callback();
        };
        child.once("error", (error) => settle(() => rejectReady(error)));
        child.once("exit", (code) =>
          settle(() => rejectReady(new Error(`writer child exited before ready: ${String(code)}`))),
        );
        child.stdout.once("data", (chunk) => {
          if (String(chunk).includes("READY")) settle(resolveReady);
          else settle(() => rejectReady(new Error(`unexpected child output: ${String(chunk)}`)));
        });
      });
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
    child.kill("SIGKILL");
    await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));

    const reopened = await SQLiteEventStore.open({ path, projectId });
    expect(reopened.list()).toEqual([]);
    reopened.close();
  });

  it("refuses a database bound to another project", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    store.close();

    await expect(SQLiteEventStore.open({ path, projectId: "prj_99999999" })).rejects.toMatchObject({
      code: "project_mismatch",
    });
  });

  it("rejects updates and deletes at the SQLite boundary", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    store.append(draft());
    store.close();

    const raw = new DatabaseSync(path);
    expect(() =>
      raw.prepare("UPDATE events SET payload_json = '{}' WHERE event_id = ?").run("evt_01234567"),
    ).toThrow("events are append-only");
    expect(() => raw.prepare("DELETE FROM events WHERE event_id = ?").run("evt_01234567")).toThrow(
      "events are append-only",
    );
    raw.close();
  });

  it("detects a modified event during restart", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    store.append(draft());
    store.close();

    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER events_no_update;");
    raw
      .prepare("UPDATE events SET payload_json = ? WHERE event_id = ?")
      .run('{"role":"tampered"}', "evt_01234567");
    raw.close();

    await expect(SQLiteEventStore.open({ path, projectId })).rejects.toMatchObject({
      code: "integrity_failed",
    });
  });
});

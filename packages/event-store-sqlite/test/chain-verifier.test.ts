import { DatabaseSync } from "node:sqlite";

import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQLiteEventChainVerifier } from "../src/chain-verifier.js";
import { SQLiteEventRepository } from "../src/event-repository.js";
import { migrateDatabase } from "../src/migrations.js";
import * as codec from "../src/row-codec.js";
import { sqliteRows } from "../src/sqlite-row.js";

const projectId = "prj_integritypages";
const databases: DatabaseSync[] = [];

function fixture(count: number) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  migrateDatabase(database);
  const repository = new SQLiteEventRepository(database, projectId, 1);
  const append = (index: number) =>
    repository.append({
      schemaVersion: 1,
      eventId: `evt_integrity_${index}`,
      projectId,
      runId: "run_integritypages",
      sessionId: "ses_integritypages",
      type: "run.requested",
      occurredAt: "2026-10-09T00:00:00Z",
      actor: { kind: "user" },
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer" },
    });
  for (let index = 0; index < count; index += 1) append(index);
  return { database, append, verifier: new SQLiteEventChainVerifier(database, projectId) };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

describe("exact-byte event-chain verification receipts", () => {
  it("reuses unchanged pages and validates an appended tail with the same full-chain result", () => {
    const { database, append, verifier } = fixture(1_002);
    const decode = vi.spyOn(codec, "rowToEvent");
    const initial = verifier.verify();
    expect(initial.eventCount).toBe(1_002);
    expect(decode).toHaveBeenCalledTimes(1_002);
    decode.mockClear();
    expect(verifier.verify()).toEqual(initial);
    expect(decode).not.toHaveBeenCalled();
    append(1_002);
    decode.mockClear();
    const appended = verifier.verify();
    expect(decode).toHaveBeenCalledTimes(3);
    expect(appended).toEqual(new SQLiteEventChainVerifier(database, projectId).verify());
    expect(appended.eventCount).toBe(1_003);
  });

  it.each([1, 1_001])(
    "rejects changed raw payload bytes at sequence %i despite unchanged stored hashes",
    (seq) => {
      const { database, verifier } = fixture(1_002);
      verifier.verify();
      database.exec("DROP TRIGGER events_no_update");
      database
        .prepare("UPDATE events SET payload_json = ? WHERE seq = ?")
        .run(JSON.stringify({ requestDigest: `sha256:${"c".repeat(64)}`, role: "developer" }), seq);
      expect(() => verifier.verify()).toThrow(/hash does not match/);
      expect(() => verifier.verify()).toThrow(/hash does not match/);
    },
  );

  it("does not reuse a later page when the preceding chain was rewritten", () => {
    const { database, verifier } = fixture(1_001);
    verifier.verify();
    database.exec("DROP TRIGGER events_no_update");
    const prefix = sqliteRows(
      database.prepare("SELECT * FROM events WHERE seq <= 1000 ORDER BY seq").all(),
    );
    let previousHash: string | null = null;
    for (const row of prefix) {
      const event = codec.rowToEvent(row);
      const changed = {
        ...eventWithoutHash(event),
        occurredAt: "2026-10-09T00:00:01Z",
        previousHash,
      };
      const hash = computeEventHash(changed);
      database
        .prepare(
          "UPDATE events SET occurred_at = ?, previous_hash = ?, event_hash = ? WHERE seq = ?",
        )
        .run(changed.occurredAt, previousHash, hash, event.seq);
      previousHash = hash;
    }
    // The cached second page's raw bytes are unchanged, but its incoming chain is different.
    expect(() => verifier.verify()).toThrow(/chain coordinates break/);
  });

  it("drops receipts after truncation and does not retain a rolled-back tail", () => {
    const { database, append, verifier } = fixture(1_001);
    verifier.verify();
    database.exec("BEGIN");
    append(1_001);
    expect(verifier.verify().eventCount).toBe(1_002);
    database.exec("ROLLBACK");
    expect(verifier.verify()).toEqual(new SQLiteEventChainVerifier(database, projectId).verify());
    database.exec("DROP TRIGGER events_no_delete; DELETE FROM events WHERE seq > 1000");
    expect(verifier.verify().eventCount).toBe(1_000);
    database.exec("DELETE FROM events WHERE seq = 1");
    expect(() => verifier.verify()).toThrow(/chain coordinates break/);
  });

  it("never exposes its cached receipt through a mutable report", () => {
    const { verifier } = fixture(1);
    const report = verifier.verify();
    report.eventCount = 999;
    expect(verifier.verify().eventCount).toBe(1);
  });
});

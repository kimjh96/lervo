import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { EventStoreError } from "../src/errors.js";
import { captureReport } from "../src/report-codec.js";
import { SQLiteReportRepository } from "../src/report-repository.js";
import { reportSchema } from "../src/report-schema.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  databases.push(database);
  database.exec(reportSchema);
  let writable = false;
  let readable = true;
  const repository = new SQLiteReportRepository(
    database,
    () => {
      if (!readable) throw new EventStoreError("closed", "Closed test handle.");
    },
    () => {
      if (!writable) throw new EventStoreError("read_only", "No owning test transaction.");
    },
  );
  function transact<T>(work: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    writable = true;
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      writable = false;
    }
  }
  return { database, repository, transact, closeReads: () => (readable = false) };
}

describe("SQLite report repository", () => {
  it("deduplicates complete content and returns independent decoded bytes", () => {
    const { repository, transact } = fixture();
    const body = randomBytes(4_096);
    const first = transact(() => repository.insert(body));
    expect(first.created).toBe(true);
    expect(transact(() => repository.insert(body))).toEqual({ ...first, created: false });
    const read = repository.get(first.contentHash)!;
    expect(read).toEqual(body);
    read.fill(0);
    expect(repository.get(first.contentHash)).toEqual(body);
  });

  it("requires its owning transaction and readable connection", () => {
    const { repository, closeReads } = fixture();
    expect(() => repository.insert(Buffer.from("report"))).toThrowError(
      expect.objectContaining({ code: "read_only" }),
    );
    closeReads();
    expect(() => repository.get("sha256:" + "0".repeat(64))).toThrowError(
      expect.objectContaining({ code: "closed" }),
    );
  });

  it("distinguishes absence from a missing or corrupted chunk", () => {
    const { repository, database, transact } = fixture();
    expect(repository.get("sha256:" + "0".repeat(64))).toBeNull();
    const saved = transact(() => repository.insert(randomBytes(4_096)));
    database
      .prepare("DELETE FROM quality_report_chunks WHERE hash = ? AND part = 1")
      .run(saved.contentHash);
    expect(() => repository.get(saved.contentHash)).toThrowError(
      expect.objectContaining({ code: "report_corrupt" }),
    );
  });

  it("does not replace a corrupted existing object on retry", () => {
    const { repository, database, transact } = fixture();
    const body = Buffer.from("private report");
    const saved = transact(() => repository.insert(body));
    database
      .prepare("UPDATE quality_report_chunks SET body = zeroblob(length(body)) WHERE hash = ?")
      .run(saved.contentHash);
    expect(() => transact(() => repository.insert(body))).toThrowError(
      expect.objectContaining({ code: "report_corrupt" }),
    );
  });

  it("rolls back headers, chunks and the owning event together", () => {
    const { repository, database, transact } = fixture();
    database.exec("CREATE TABLE test_events(id INTEGER PRIMARY KEY)");
    let hash = "";
    expect(() =>
      transact(() => {
        hash = repository.insert(Buffer.from("report")).contentHash;
        database.exec("INSERT INTO test_events VALUES(1)");
        throw new Error("owner failure");
      }),
    ).toThrow("owner failure");
    expect(repository.get(hash)).toBeNull();
    expect(database.prepare("SELECT count(*) AS n FROM test_events").get()).toEqual({ n: 0 });
  });

  it("rolls back partial insertion when a later chunk fails", () => {
    const { repository, database, transact } = fixture();
    database.exec(
      "CREATE TRIGGER fail_chunk BEFORE INSERT ON quality_report_chunks WHEN NEW.part = 1 BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );
    expect(() => transact(() => repository.insert(randomBytes(4_096)))).toThrow("injected");
    expect(database.prepare("SELECT count(*) AS n FROM quality_reports").get()).toEqual({ n: 0 });
    expect(database.prepare("SELECT count(*) AS n FROM quality_report_chunks").get()).toEqual({
      n: 0,
    });
  });

  it("bounds retained decoded bytes without removing existing reports", () => {
    const { repository, transact } = fixture();
    let firstHash = "";
    for (let index = 0; index < 64; index++) {
      const body = Buffer.alloc(1_048_576, index);
      const saved = transact(() => repository.insert(body));
      if (index === 0) firstHash = saved.contentHash;
    }
    expect(() => transact(() => repository.insert(Buffer.from("capacity overflow")))).toThrowError(
      expect.objectContaining({ code: "report_capacity_exceeded" }),
    );
    expect(repository.get(firstHash)).toEqual(Buffer.alloc(1_048_576));
    expect(transact(() => repository.insert(Buffer.alloc(1_048_576))).created).toBe(false);
  });
  it("rejects oversized stored chunks without returning their complete body", () => {
    const { repository, database, transact } = fixture();
    const saved = transact(() => repository.insert(Buffer.from("report")));
    database.exec("PRAGMA ignore_check_constraints = ON");
    database
      .prepare("UPDATE quality_report_chunks SET body = zeroblob(1048576) WHERE hash = ?")
      .run(saved.contentHash);
    expect(() => repository.get(saved.contentHash)).toThrowError(
      expect.objectContaining({ code: "report_corrupt" }),
    );
  });

  it("rejects orphan chunks instead of reporting an absent artifact", () => {
    const { repository, database, transact } = fixture();
    const saved = transact(() => repository.insert(Buffer.from("report")));
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("DELETE FROM quality_reports WHERE hash = ?").run(saved.contentHash);
    expect(() => repository.get(saved.contentHash)).toThrowError(
      expect.objectContaining({ code: "report_corrupt" }),
    );
  });

  it("bounds object count even when every report is small", () => {
    const { repository, database, transact } = fixture();
    transact(() => {
      const header = database.prepare("INSERT INTO quality_reports VALUES (?, ?, ?, ?, ?)");
      const chunk = database.prepare("INSERT INTO quality_report_chunks VALUES (?, ?, ?)");
      for (let index = 0; index < 16_384; index++) {
        const encoded = captureReport(Buffer.from(String(index))).encode();
        const h = encoded.header;
        header.run(h.contentHash, h.codec, h.byteCount, h.encodedByteCount, h.chunkCount);
        for (const c of encoded.chunks) chunk.run(h.contentHash, c.part, c.body);
      }
    });
    expect(() => transact(() => repository.insert(Buffer.from("another object")))).toThrowError(
      expect.objectContaining({ code: "report_capacity_exceeded" }),
    );
    expect(transact(() => repository.insert(Buffer.from("0"))).created).toBe(false);
  });
});

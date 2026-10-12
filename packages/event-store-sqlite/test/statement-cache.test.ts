import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";

import { SQLiteReportRepository } from "../src/report-repository.js";
import { reportSchema } from "../src/report-schema.js";
import { preparedStatement } from "../src/statement-cache.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

function open() {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  databases.push(database);
  database.exec(reportSchema);
  return database;
}

it("reuses one statement per connection and SQL text", () => {
  const first = open(),
    second = open();
  const statement = preparedStatement(first, "SELECT count(*) AS n FROM quality_reports");
  expect(preparedStatement(first, "SELECT count(*) AS n FROM quality_reports")).toBe(statement);
  expect(preparedStatement(second, "SELECT count(*) AS n FROM quality_reports")).not.toBe(
    statement,
  );
  expect(preparedStatement(first, "SELECT 1 AS n")).not.toBe(statement);
});

it("keeps full reads, corruption detection and failed writes intact with reused statements", () => {
  const database = open();
  const repository = new SQLiteReportRepository(
    database,
    () => {},
    () => {},
  );
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const bodies = Array.from({ length: 6 }, () => randomBytes(4_096));
  const saved = bodies.map((body) => repository.insert(body));
  for (const [index, body] of bodies.entries())
    expect(Buffer.from(repository.get(saved[index]!.contentHash)!)).toEqual(body);
  const preparedSql = prepare.mock.calls.map(([sql]) => sql);
  expect(new Set(preparedSql).size).toBe(preparedSql.length);

  // A reused statement must observe current rows, not a prior result.
  database
    .prepare("UPDATE quality_report_chunks SET body = zeroblob(length(body)) WHERE hash = ?")
    .run(saved[0]!.contentHash);
  expect(() => repository.get(saved[0]!.contentHash)).toThrowError(
    expect.objectContaining({ code: "report_corrupt" }),
  );

  // A constraint failure resets the cached insert statement for the next caller.
  const insert = preparedStatement(
    database,
    "INSERT INTO quality_report_chunks(hash, part, body) VALUES (?, ?, ?)",
  );
  expect(() => insert.run(saved[1]!.contentHash, 0, Buffer.from("duplicate"))).toThrow();
  const next = repository.insert(Buffer.from("written after a failed statement"));
  expect(next.created).toBe(true);
  expect(Buffer.from(repository.get(next.contentHash)!).toString()).toBe(
    "written after a failed statement",
  );
});

import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";

import { SQLiteReportRepository } from "../src/report-repository.js";
import { reportSchema } from "../src/report-schema.js";

vi.mock("node:zlib", async (original) => {
  const zlib = await original<typeof import("node:zlib")>();
  return { ...zlib, deflateRawSync: vi.fn(zlib.deflateRawSync) };
});

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  databases.push(database);
  database.exec(reportSchema);
  return {
    database,
    repository: new SQLiteReportRepository(
      database,
      () => {},
      () => {},
    ),
  };
}

it("reads and verifies duplicates without compressing them again", () => {
  const { database, repository } = fixture();
  const body = randomBytes(65_536);
  const saved = repository.insert(body);
  expect(deflateRawSync).toHaveBeenCalledTimes(1);
  expect(repository.insert(Buffer.from(body))).toEqual({ ...saved, created: false });
  expect(deflateRawSync).toHaveBeenCalledTimes(1);

  database
    .prepare("UPDATE quality_report_chunks SET body = zeroblob(length(body)) WHERE hash = ?")
    .run(saved.contentHash);
  expect(() => repository.insert(body)).toThrowError(
    expect.objectContaining({ code: "report_corrupt" }),
  );
  expect(deflateRawSync).toHaveBeenCalledTimes(1);
  expect(repository.insert(Buffer.from("another report")).created).toBe(true);
  expect(deflateRawSync).toHaveBeenCalledTimes(2);
});

it("captures caller bytes before lookup can change the input", () => {
  const { repository } = fixture();
  const body = Buffer.from("private snapshot before lookup");
  const expected = Buffer.from(body);
  const get = repository.get;
  vi.spyOn(repository, "get").mockImplementation(function (hash) {
    body.fill(0);
    return get.call(repository, hash);
  });
  const saved = repository.insert(body);
  expect(repository.get(saved.contentHash)).toEqual(expected);
  expect(repository.insert(expected)).toEqual({ ...saved, created: false });
  expect(deflateRawSync).toHaveBeenCalledTimes(1);
});

it.each([new Uint8Array(), new Uint8Array(1_048_577), new Uint8Array(new SharedArrayBuffer(8))])(
  "rejects invalid input before lookup or compression",
  (content) => {
    const { repository } = fixture();
    const get = vi.spyOn(repository, "get");
    expect(() => repository.insert(content)).toThrowError(
      expect.objectContaining({ code: "invalid_report" }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(deflateRawSync).not.toHaveBeenCalled();
  },
);

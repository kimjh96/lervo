import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { applyInitPlan, createInitPlan, resolveProjectPaths } from "@lervo/project";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { afterEach, expect, it, vi } from "vitest";

import { openProjectStorage, openReadOnlyProjectStorage } from "../src/index.js";
import { withReportReader } from "../src/report-artifact-reader.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-report-artifacts-"));
  roots.push(root);
  const projectId = "prj_report_artifacts";
  await applyInitPlan(
    await createInitPlan({ root, projectId, now: new Date("2026-10-11T00:00:00Z") }),
  );
  const paths = resolveProjectPaths(root);
  (
    await SQLiteEventStore.open({
      path: paths.eventDatabase,
      projectId,
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    })
  ).close();
  const body = Buffer.from("complete SQL report");
  const hash = "sha256:" + createHash("sha256").update(body).digest("hex");
  const encoded = deflateRawSync(body, { level: 1 });
  const database = new DatabaseSync(paths.eventDatabase);
  try {
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare("INSERT INTO quality_reports VALUES (?, 'deflate_raw_v1', ?, ?, 1)")
      .run(hash, body.length, encoded.length);
    database.prepare("INSERT INTO quality_report_chunks VALUES (?, 0, ?)").run(hash, encoded);
    database.exec("COMMIT");
  } finally {
    database.close();
  }
  return { root, paths, body, hash, uri: `lervo-cas://sha256/${hash.slice(7)}` };
}

it("reads mixed report and CAS history through owner and read-only storage", async () => {
  const { root, body, uri } = await fixture();
  const owner = await openProjectStorage(root);
  const legacy = await owner.artifacts.put("legacy CAS body");
  try {
    expect(await owner.artifacts.get(uri)).toEqual(body);
    expect(await owner.artifacts.has(uri)).toBe(true);
    expect(Buffer.from(await owner.artifacts.get(legacy.uri)).toString()).toBe("legacy CAS body");
    const reader = await openReadOnlyProjectStorage(root);
    try {
      expect(await reader.artifacts.get(uri)).toEqual(body);
      expect(await reader.artifacts.has(legacy.uri)).toBe(true);
      await expect(reader.artifacts.put("not permitted")).rejects.toMatchObject({
        code: "read_only",
      });
    } finally {
      await reader.close();
    }
    await expect(reader.artifacts.get(uri)).rejects.toMatchObject({ code: "closed" });
  } finally {
    await owner.close();
  }
});

it("does not hide a corrupt SQL object with a valid CAS copy", async () => {
  const { root, paths, body, hash, uri } = await fixture();
  const owner = await openProjectStorage(root);
  try {
    expect((await owner.artifacts.put(body)).uri).toBe(uri);
    const database = new DatabaseSync(paths.eventDatabase);
    try {
      database
        .prepare("UPDATE quality_report_chunks SET body = zeroblob(length(body)) WHERE hash = ?")
        .run(hash);
    } finally {
      database.close();
    }
    await expect(owner.artifacts.get(uri)).rejects.toMatchObject({ code: "report_corrupt" });
    await expect(owner.artifacts.has(uri)).rejects.toMatchObject({ code: "report_corrupt" });
  } finally {
    await owner.close();
  }
});

it("preserves custom backend writes, streamed inputs, unsupported URIs and cleanup binding", async () => {
  const artifact = {
    uri: "custom:uri",
    contentHash: "sha256:" + "a".repeat(64),
    byteCount: 1,
    created: true,
  };
  const base = {
    marker: "owner",
    put: vi.fn(async () => artifact),
    putStream: vi.fn(async () => artifact),
    get: vi.fn(async () => new Uint8Array([1])),
    has: vi.fn(async () => false),
    close: vi.fn(async function (this: { marker: string }) {
      expect(this.marker).toBe("owner");
    }),
  };
  const reports = { getReport: vi.fn(() => null) };
  const wrapped = withReportReader(base, reports);
  expect(withReportReader(base, undefined)).toBe(base);
  expect(await wrapped.put("a")).toBe(artifact);
  const stream = (async function* () {
    yield "a";
  })();
  expect(await wrapped.putStream(stream)).toBe(artifact);
  expect(base.putStream).toHaveBeenCalledWith(stream);
  await wrapped.get("custom:uri");
  await wrapped.has("custom:uri");
  expect(reports.getReport).not.toHaveBeenCalled();
  await wrapped.close?.();
  expect(base.close).toHaveBeenCalledTimes(1);
});

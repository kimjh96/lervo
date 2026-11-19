import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DOCUMENT_LIFECYCLE_RECORD_PATH,
  emptyDocumentLifecycleRecord,
  MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS,
  readDocumentLifecycleRecord,
  writeDocumentLifecycleRecord,
  type DocumentLifecycleRecord,
} from "../src/document-lifecycle-record.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-lifecycle-record-"));
  roots.push(path);
  return path;
}

const revision = "a".repeat(40);

function record(documents: number): DocumentLifecycleRecord {
  const entries: DocumentLifecycleRecord["documents"] = {};
  for (let index = 0; index < documents; index += 1)
    entries[`docs/${String(index).padStart(5, "0")}.md`] = {
      contentHash: `sha256:${"b".repeat(64)}`,
      assessedRevision: revision,
      evaluatedAt: "2026-11-19T06:00:00.000Z",
    };
  return {
    schemaVersion: 1,
    kind: "document_lifecycle.record",
    revision,
    documents: entries,
    unknownCommands: ["lervo loop"],
    cadence: { day: "2026-11-19", assessed: 3 },
  };
}

async function writeRaw(repository: string, text: string): Promise<void> {
  const path = resolve(repository, DOCUMENT_LIFECYCLE_RECORD_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

describe("document lifecycle record (ADR-0562)", () => {
  it("round-trips through a private file", async () => {
    const repository = await root();
    const value = record(2);
    await writeDocumentLifecycleRecord(repository, value);
    const path = resolve(repository, DOCUMENT_LIFECYCLE_RECORD_PATH);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readDocumentLifecycleRecord(repository)).toEqual(value);
  });

  it("bounds the documents it writes", async () => {
    const repository = await root();
    await writeDocumentLifecycleRecord(repository, record(MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS + 3));
    const read = await readDocumentLifecycleRecord(repository);
    expect(Object.keys(read.documents)).toHaveLength(MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS);
  });

  it("reads a missing, malformed, or foreign record as empty", async () => {
    const repository = await root();
    expect(await readDocumentLifecycleRecord(repository)).toEqual(emptyDocumentLifecycleRecord());
    await writeRaw(repository, "{not json");
    expect(await readDocumentLifecycleRecord(repository)).toEqual(emptyDocumentLifecycleRecord());
    await writeRaw(repository, JSON.stringify({ ...record(1), kind: "other" }));
    expect(await readDocumentLifecycleRecord(repository)).toEqual(emptyDocumentLifecycleRecord());
  });

  it("drops entries that are not valid instead of failing the record", async () => {
    const repository = await root();
    const value = record(1);
    await writeRaw(
      repository,
      JSON.stringify({
        ...value,
        documents: {
          ...value.documents,
          "docs/bad-revision.md": { ...value.documents["docs/00000.md"], assessedRevision: "HEAD" },
          "docs/bad-time.md": { ...value.documents["docs/00000.md"], evaluatedAt: "soon" },
        },
        unknownCommands: ["lervo loop", 7],
      }),
    );
    const read = await readDocumentLifecycleRecord(repository);
    expect(Object.keys(read.documents)).toEqual(["docs/00000.md"]);
    expect(read.unknownCommands).toEqual(["lervo loop"]);
  });
});

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openSqliteDatabase } from "@lervo/sqlite-connection";

import { buildRelationWeb, type RelationWeb } from "../src/relation-web.js";
import { readRelationWebStore, writeRelationWebStore } from "../src/relation-web-store.js";

function sample(revision: string): RelationWeb {
  return buildRelationWeb({
    documents: [
      {
        path: "docs/decisions/0002-next.md",
        content:
          "# ADR-0002: Next\n\nStatus: `accepted`\nSupersedes in part: ADR-0001 (old part)\n\nRun `lervo knowledge query` on `packages/core/src/a.ts`.\n",
        role: "canonical_documents",
      },
      {
        path: "docs/decisions/0001-old.md",
        content: "# ADR-0001: Old\n",
        role: "canonical_documents",
      },
    ],
    trackedFiles: [
      "packages/core/src/a.ts",
      "docs/decisions/0001-old.md",
      "docs/decisions/0002-next.md",
    ],
    packages: [{ name: "@lervo/core", directory: "packages/core" }],
    commands: ["lervo knowledge query"],
    lineage: [{ kind: "retired", from: "docs/gone.md", record: "lineage.yaml" }],
    archiveScopes: [],
    observedRevision: revision,
  }).web;
}

function comparable(web: RelationWeb) {
  return {
    ...web,
    documents: [...web.documents.values()],
    inbound: [...web.inbound.entries()],
  };
}

describe("relation web store", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lervo-relation-web-"));
    path = join(directory, "relation-web.sqlite");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips the web privately", async () => {
    expect(readRelationWebStore(path)).toBeNull();
    const web = sample("rev1");
    writeRelationWebStore(path, web, "2026-11-02T00:00:00.000Z");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(comparable(readRelationWebStore(path)!)).toEqual(comparable(web));
  });

  it("keeps the previous web when a write fails", () => {
    writeRelationWebStore(path, sample("rev1"), "2026-11-02T00:00:00.000Z");
    const broken = sample("rev2");
    const document = broken.documents.get("docs/decisions/0001-old.md")!;
    (document as { contentHash: string | null }).contentHash = null;
    expect(() => writeRelationWebStore(path, broken, "2026-11-02T00:01:00.000Z")).toThrow();
    expect(readRelationWebStore(path)!.observedRevision).toBe("rev1");
  });

  it("discards a corrupt or differently versioned store and rebuilds it", async () => {
    await writeFile(path, "not a database");
    expect(readRelationWebStore(path)).toBeNull();
    writeRelationWebStore(path, sample("rev1"), "2026-11-02T00:00:00.000Z");
    expect(readRelationWebStore(path)!.observedRevision).toBe("rev1");

    const database = openSqliteDatabase(path, { busyTimeoutMs: 0 });
    database.exec("PRAGMA user_version = 99");
    database.close();
    expect(readRelationWebStore(path)).toBeNull();
    writeRelationWebStore(path, sample("rev2"), "2026-11-02T00:00:00.000Z");
    expect(readRelationWebStore(path)!.observedRevision).toBe("rev2");
  });
});

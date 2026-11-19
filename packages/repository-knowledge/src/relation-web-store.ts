import { constants, chmodSync, closeSync, lstatSync, openSync, rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import type {
  DocumentLifecycleEntry,
  DocumentLifecycleEvidence,
  DocumentLifecycleState,
} from "./document-lifecycle-model.js";
import {
  type RelationDocument,
  type RelationEdge,
  type RelationEdgeKind,
  type RelationEdgeStrength,
  type RelationLineageKind,
  type RelationLineageRecord,
} from "./relation-web-model.js";
import { assembleRelationWeb, type RelationWeb } from "./relation-web.js";

/** Repository-relative location of the private, rebuildable relation web (ADR-0562). */
export const RELATION_WEB_STATE_PATH = ".lervo/state/relation-web.sqlite";

/**
 * Bumped when a table changes; a different stored version is discarded and rebuilt. Version 2 adds
 * the document lifecycle table, which is rebuilt from the lifecycle record and the web.
 */
const SCHEMA_VERSION = 2;

const schema = [
  "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE documents(path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, extractor_version INTEGER NOT NULL, observed_revision TEXT, adr TEXT, status TEXT, truncated INTEGER NOT NULL, role TEXT NOT NULL, historical INTEGER NOT NULL)",
  "CREATE TABLE edges(source_document TEXT NOT NULL, kind TEXT NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, line INTEGER NOT NULL, strength TEXT NOT NULL, extractor_version INTEGER NOT NULL, observed_revision TEXT, part TEXT)",
  "CREATE INDEX edges_by_source ON edges(source_document)",
  "CREATE INDEX edges_by_target ON edges(to_node)",
  "CREATE TABLE tracked_files(path TEXT PRIMARY KEY)",
  "CREATE TABLE packages(name TEXT PRIMARY KEY, directory TEXT NOT NULL)",
  "CREATE TABLE commands(name TEXT PRIMARY KEY)",
  "CREATE TABLE lineage(kind TEXT NOT NULL, from_path TEXT NOT NULL, to_path TEXT, record TEXT NOT NULL)",
  "CREATE TABLE lifecycle(path TEXT PRIMARY KEY, state TEXT NOT NULL, reasons TEXT NOT NULL, assessed_revision TEXT, verified_revision TEXT, superseded_parts TEXT NOT NULL)",
];

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`relation web column ${key} is not text`);
  return value;
}

function optionalText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function integer(row: Row, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`relation web column ${key} is not integer`);
  return value;
}

function rows(database: DatabaseSync, sql: string): Row[] {
  return database.prepare(sql).all() as Row[];
}

function removeStore(path: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    rmSync(`${path}${suffix}`, { force: true });
}

function openStore(path: string): DatabaseSync {
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  closeSync(descriptor);
  chmodSync(path, 0o600);
  return openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
}

function storedVersion(database: DatabaseSync): number {
  return integer(database.prepare("PRAGMA user_version").get() as Row, "user_version");
}

function readDocuments(database: DatabaseSync): RelationDocument[] {
  const edges = new Map<string, RelationEdge[]>();
  for (const row of rows(database, "SELECT * FROM edges ORDER BY rowid")) {
    const source = text(row, "source_document");
    const part = optionalText(row, "part");
    const edge: RelationEdge = {
      kind: text(row, "kind") as RelationEdgeKind,
      from: text(row, "from_node"),
      to: text(row, "to_node"),
      evidence: {
        extractorVersion: integer(row, "extractor_version"),
        sourceDocument: source,
        line: integer(row, "line"),
        strength: text(row, "strength") as RelationEdgeStrength,
        observedRevision: optionalText(row, "observed_revision"),
      },
      ...(part === null ? {} : { part }),
    };
    edges.set(source, [...(edges.get(source) ?? []), edge]);
  }
  return rows(database, "SELECT * FROM documents").map((row) => ({
    path: text(row, "path"),
    contentHash: text(row, "content_hash"),
    extractorVersion: integer(row, "extractor_version"),
    observedRevision: optionalText(row, "observed_revision"),
    adr: optionalText(row, "adr"),
    status: optionalText(row, "status"),
    truncated: integer(row, "truncated") === 1,
    role: text(row, "role"),
    historical: integer(row, "historical") === 1,
    edges: edges.get(text(row, "path")) ?? [],
  }));
}

/**
 * Reads the stored web. A missing, unreadable, or differently versioned store is null, so the
 * caller extracts every document again; the store holds nothing that cannot be rebuilt.
 */
export function readRelationWebStore(path: string): RelationWeb | null {
  try {
    if (!lstatSync(path).isFile()) return null;
  } catch {
    return null;
  }
  let database: DatabaseSync | undefined;
  try {
    database = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS, readOnly: true });
    if (storedVersion(database) !== SCHEMA_VERSION) return null;
    const meta = new Map(
      rows(database, "SELECT key, value FROM meta").map((row) => [
        text(row, "key"),
        text(row, "value"),
      ]),
    );
    const revision = meta.get("observedRevision");
    return assembleRelationWeb({
      documents: readDocuments(database),
      trackedFiles: rows(database, "SELECT path FROM tracked_files").map((row) =>
        text(row, "path"),
      ),
      packages: rows(database, "SELECT name, directory FROM packages").map((row) => ({
        name: text(row, "name"),
        directory: text(row, "directory"),
      })),
      commands: rows(database, "SELECT name FROM commands").map((row) => text(row, "name")),
      lineage: rows(database, "SELECT * FROM lineage").map((row): RelationLineageRecord => {
        const to = optionalText(row, "to_path");
        return {
          kind: text(row, "kind") as RelationLineageKind,
          from: text(row, "from_path"),
          record: text(row, "record"),
          ...(to === null ? {} : { to }),
        };
      }),
      observedRevision: revision === undefined || revision === "" ? null : revision,
    });
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

function insertWeb(database: DatabaseSync, web: RelationWeb, builtAt: string): void {
  const meta = database.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
  meta.run("observedRevision", web.observedRevision ?? "");
  meta.run("builtAt", builtAt);
  const document = database.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const edge = database.prepare("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of web.documents.values()) {
    document.run(
      item.path,
      item.contentHash,
      item.extractorVersion,
      item.observedRevision,
      item.adr,
      item.status,
      item.truncated ? 1 : 0,
      item.role,
      item.historical ? 1 : 0,
    );
    for (const value of item.edges)
      edge.run(
        value.evidence.sourceDocument,
        value.kind,
        value.from,
        value.to,
        value.evidence.line,
        value.evidence.strength,
        value.evidence.extractorVersion,
        value.evidence.observedRevision,
        value.part ?? null,
      );
  }
  const file = database.prepare("INSERT INTO tracked_files VALUES (?)");
  for (const path of web.trackedFiles) file.run(path);
  const workspacePackage = database.prepare("INSERT INTO packages VALUES (?, ?)");
  for (const [name, directory] of web.packages) workspacePackage.run(name, directory);
  const command = database.prepare("INSERT INTO commands VALUES (?)");
  for (const name of web.commands) command.run(name);
  const lineage = database.prepare("INSERT INTO lineage VALUES (?, ?, ?, ?)");
  for (const record of web.lineage)
    lineage.run(record.kind, record.from, record.to ?? null, record.record);
}

/** The stored document lifecycle rows, or an empty list when the store is missing or other. */
export function readRelationWebLifecycle(path: string): DocumentLifecycleEntry[] {
  let database: DatabaseSync | undefined;
  try {
    if (!lstatSync(path).isFile()) return [];
    database = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS, readOnly: true });
    if (storedVersion(database) !== SCHEMA_VERSION) return [];
    return rows(database, "SELECT * FROM lifecycle ORDER BY path").map((row) => ({
      path: text(row, "path"),
      state: text(row, "state") as DocumentLifecycleState,
      reasons: JSON.parse(text(row, "reasons")) as DocumentLifecycleEvidence[],
      assessedRevision: optionalText(row, "assessed_revision"),
      verifiedRevision: optionalText(row, "verified_revision"),
      supersededParts: JSON.parse(text(row, "superseded_parts")) as string[],
    }));
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

function writeLifecycle(
  database: DatabaseSync,
  web: RelationWeb,
  lifecycle: readonly DocumentLifecycleEntry[] | "keep",
): void {
  if (lifecycle === "keep") {
    // Rows of documents that still exist stay; each carries the revisions it was computed at.
    const remove = database.prepare("DELETE FROM lifecycle WHERE path = ?");
    for (const row of rows(database, "SELECT path FROM lifecycle"))
      if (!web.documents.has(text(row, "path"))) remove.run(text(row, "path"));
    return;
  }
  database.exec("DELETE FROM lifecycle");
  const insert = database.prepare("INSERT INTO lifecycle VALUES (?, ?, ?, ?, ?, ?)");
  for (const entry of lifecycle)
    insert.run(
      entry.path,
      entry.state,
      JSON.stringify(entry.reasons),
      entry.assessedRevision,
      entry.verifiedRevision,
      JSON.stringify(entry.supersededParts),
    );
}

/**
 * Replaces the stored web in one transaction. A failure rolls back, so the previous web stays in
 * place; the caller reports `relation_web_stale`. A store that cannot be opened or migrated is
 * deleted and created again, because it is a rebuildable projection. `lifecycle` replaces the
 * lifecycle rows, or `"keep"` keeps the rows of documents that still exist.
 */
export function writeRelationWebStore(
  path: string,
  web: RelationWeb,
  builtAt: string,
  lifecycle: readonly DocumentLifecycleEntry[] | "keep",
): void {
  let database: DatabaseSync | undefined;
  try {
    database = openStore(path);
    const version = storedVersion(database);
    if (version !== 0 && version !== SCHEMA_VERSION) throw new Error("other schema version");
  } catch {
    database?.close();
    removeStore(path);
    database = openStore(path);
  }
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (storedVersion(database) !== SCHEMA_VERSION) {
        for (const statement of schema) database.exec(statement);
        database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      } else
        for (const table of [
          "meta",
          "documents",
          "edges",
          "tracked_files",
          "packages",
          "commands",
          "lineage",
        ])
          database.exec(`DELETE FROM ${table}`);
      insertWeb(database, web, builtAt);
      writeLifecycle(database, web, lifecycle);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

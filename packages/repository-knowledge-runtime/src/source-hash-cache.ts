import { chmodSync, lstatSync, rmSync, type BigIntStats } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SOURCE_HASH_CACHE_PATH = ".lervo/state/knowledge/source-hash-cache.sqlite";
const MAXIMUM_ROWS = 50_000;
const SCHEMA_VERSION = 1;
/** Entries hashed within this window of their last metadata change are racy and never trusted. */
const RACY_WINDOW_NANOSECONDS = 2_000_000_000n;

export interface CachedSourceHash {
  contentHash: string;
  kind: "text" | "opaque";
}

interface CacheRow extends CachedSourceHash {
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  ino: string;
  hashedAtNs: string;
}

/**
 * A private rebuildable projection from exact file metadata to the content hash it was read with.
 * It accelerates capture only; a miss, a racy entry, or any cache failure reads the bytes again.
 */
export interface SourceHashCache {
  lookup(path: string, stat: BigIntStats): CachedSourceHash | null;
  record(path: string, stat: BigIntStats, hashedAtNs: bigint, value: CachedSourceHash): void;
  /** Persist recorded misses and prune every path absent from the complete capture. */
  commit(presentPaths: ReadonlySet<string>): void;
  close(): void;
}

const disabled: SourceHashCache = {
  lookup: () => null,
  record: () => undefined,
  commit: () => undefined,
  close: () => undefined,
};

function privateDirectory(root: string): string | null {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    } catch {
      return null;
    }
  }
  return directory;
}

function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec("PRAGMA busy_timeout=5000");
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== SCHEMA_VERSION) {
      db.exec("DROP TABLE IF EXISTS sources");
      db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    }
    db.exec(
      "CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY,size TEXT NOT NULL,mtime_ns TEXT NOT NULL,ctime_ns TEXT NOT NULL,ino TEXT NOT NULL,hashed_at_ns TEXT NOT NULL,sha256 TEXT NOT NULL,kind TEXT NOT NULL)",
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function loadRows(db: DatabaseSync): Map<string, CacheRow> {
  const rows = new Map<string, CacheRow>();
  for (const row of db.prepare("SELECT * FROM sources").all()) {
    if (
      typeof row.path !== "string" ||
      typeof row.sha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(row.sha256) ||
      (row.kind !== "text" && row.kind !== "opaque")
    )
      continue;
    rows.set(row.path, {
      contentHash: row.sha256,
      kind: row.kind,
      size: String(row.size),
      mtimeNs: String(row.mtime_ns),
      ctimeNs: String(row.ctime_ns),
      ino: String(row.ino),
      hashedAtNs: String(row.hashed_at_ns),
    });
  }
  return rows;
}

function removeDatabase(path: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    rmSync(`${path}${suffix}`, { force: true });
}

/** Open the repository's cache; an unavailable or corrupt cache is deleted once, then bypassed. */
export function openSourceHashCache(root: string): SourceHashCache {
  const directory = privateDirectory(root);
  if (directory === null) return disabled;
  const path = resolve(directory, "source-hash-cache.sqlite");
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return disabled;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return disabled;
  }
  let db: DatabaseSync;
  let rows: Map<string, CacheRow>;
  try {
    db = openDatabase(path);
    rows = loadRows(db);
  } catch {
    try {
      removeDatabase(path);
      db = openDatabase(path);
      rows = loadRows(db);
    } catch {
      return disabled;
    }
  }
  const recorded = new Map<string, CacheRow>();
  return {
    lookup(source, stat) {
      const row = rows.get(source);
      if (
        row === undefined ||
        row.size !== stat.size.toString() ||
        row.mtimeNs !== stat.mtimeNs.toString() ||
        row.ctimeNs !== stat.ctimeNs.toString() ||
        row.ino !== stat.ino.toString()
      )
        return null;
      const hashedAt = BigInt(row.hashedAtNs);
      if (
        stat.mtimeNs + RACY_WINDOW_NANOSECONDS >= hashedAt ||
        stat.ctimeNs + RACY_WINDOW_NANOSECONDS >= hashedAt
      )
        return null;
      return { contentHash: row.contentHash, kind: row.kind };
    },
    record(source, stat, hashedAtNs, value) {
      recorded.set(source, {
        ...value,
        size: stat.size.toString(),
        mtimeNs: stat.mtimeNs.toString(),
        ctimeNs: stat.ctimeNs.toString(),
        ino: stat.ino.toString(),
        hashedAtNs: hashedAtNs.toString(),
      });
    },
    commit(presentPaths) {
      if (presentPaths.size > MAXIMUM_ROWS) return;
      try {
        db.exec("BEGIN IMMEDIATE");
        try {
          const remove = db.prepare("DELETE FROM sources WHERE path=?");
          for (const source of rows.keys()) if (!presentPaths.has(source)) remove.run(source);
          const upsert = db.prepare(
            "INSERT INTO sources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime_ns=excluded.mtime_ns,ctime_ns=excluded.ctime_ns,ino=excluded.ino,hashed_at_ns=excluded.hashed_at_ns,sha256=excluded.sha256,kind=excluded.kind",
          );
          for (const [source, row] of recorded)
            if (presentPaths.has(source))
              upsert.run(
                source,
                row.size,
                row.mtimeNs,
                row.ctimeNs,
                row.ino,
                row.hashedAtNs,
                row.contentHash,
                row.kind,
              );
          if (
            Number(db.prepare("SELECT count(*) AS count FROM sources").get()!.count) > MAXIMUM_ROWS
          )
            db.exec("DELETE FROM sources");
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } catch {
        /* The cache is a rebuildable acceleration; capture correctness never depends on it. */
      }
    },
    close() {
      db.close();
    },
  };
}

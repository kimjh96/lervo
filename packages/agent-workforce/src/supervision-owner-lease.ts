import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { SupervisionProcessLock } from "./supervision-process-lock.js";

const PROCESS_LOCK_TOKEN_PREFIX = "sop1:";
const processLeaseListeners = new Map<string, Set<() => void>>();

function publishLeaseChange(path: string): void {
  for (const listener of [...(processLeaseListeners.get(path) ?? [])]) listener();
}

export interface SupervisionOwnerLease {
  supervisionId: string;
  ownerAgentId: string;
  token: string;
  generation: number;
  expiresAtMs: number;
}

interface LeaseRow {
  supervision_id: string;
  owner_agent_id: string;
  token: string;
  generation: number;
  expires_at_ms: number;
  released: number;
}

export class SupervisionLeaseError extends Error {
  constructor(
    readonly code: "lease_invalid" | "lease_lost" | "lease_capacity",
    options?: ErrorOptions,
  ) {
    super(`The supervision owner lease failed: ${code}.`, options);
    this.name = "SupervisionLeaseError";
  }
}

/** Narrows a `node:sqlite` row, which the Node 22.13 type definitions expose as `unknown`. */
function leaseDatabaseRow(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new SupervisionLeaseError("lease_invalid");
  return value as Readonly<Record<string, unknown>>;
}

/** Durable coordination only. Expiry never establishes that an external effect stopped. */
export class SQLiteSupervisionOwnerLeaseStore {
  private readonly processLocks = new Map<string, SupervisionProcessLock>();
  private readonly subscriptions = new Set<() => void>();

  private constructor(
    private readonly database: DatabaseSync,
    private readonly path: string,
  ) {}

  static open(path: string): SQLiteSupervisionOwnerLeaseStore {
    const database = openSqliteDatabase(path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      allowExtension: false,
    });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS supervision_owner_leases (
          supervision_id TEXT PRIMARY KEY,
          owner_agent_id TEXT NOT NULL,
          token TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK (generation > 0),
          expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0),
          released INTEGER NOT NULL CHECK (released IN (0, 1))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS supervision_owner_process_locks (
          supervision_id TEXT PRIMARY KEY REFERENCES supervision_owner_leases(supervision_id),
          token TEXT NOT NULL,
          file_identity TEXT NOT NULL
        ) STRICT;
      `);
      if (leaseDatabaseRow(database.prepare("PRAGMA quick_check").get())?.quick_check !== "ok")
        throw new SupervisionLeaseError("lease_invalid");
      return new SQLiteSupervisionOwnerLeaseStore(database, path);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  acquire(input: {
    supervisionId: string;
    ownerAgentId: string;
    nowMs: number;
    durationMs: number;
  }): SupervisionOwnerLease | null {
    if (
      !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(input.supervisionId) ||
      !/^agt_[a-f0-9]{24}$/u.test(input.ownerAgentId)
    )
      throw new SupervisionLeaseError("lease_invalid");
    const expiresAtMs = expiry(input.nowMs, input.durationMs);
    if (this.processLocks.has(input.supervisionId)) return null;
    const processLock = new SupervisionProcessLock(this.path, input.supervisionId);
    try {
      const acquired = this.transaction(() => {
        const previous = this.row(input.supervisionId);
        if (previous === undefined) {
          const count = leaseDatabaseRow(
            this.database.prepare("SELECT count(*) AS count FROM supervision_owner_leases").get(),
          );
          if (Number(count?.count) >= 4096) throw new SupervisionLeaseError("lease_capacity");
        }
        let fileIdentity: string | null;
        try {
          fileIdentity = processLock.acquire();
        } catch (error) {
          throw new SupervisionLeaseError("lease_invalid", { cause: error });
        }
        if (fileIdentity === null) return null;
        if (previous !== undefined && previous.released === 0) {
          if (!previous.token.startsWith(PROCESS_LOCK_TOKEN_PREFIX)) return null;
          if (this.processLockIdentity(previous) !== fileIdentity)
            throw new SupervisionLeaseError("lease_invalid");
        }
        const lease = {
          supervisionId: input.supervisionId,
          ownerAgentId: input.ownerAgentId,
          token: `${PROCESS_LOCK_TOKEN_PREFIX}${randomUUID()}`,
          generation: (previous?.generation ?? 0) + 1,
          expiresAtMs,
        };
        if (!Number.isSafeInteger(lease.generation))
          throw new SupervisionLeaseError("lease_capacity");
        this.database
          .prepare(
            `
        INSERT INTO supervision_owner_leases VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(supervision_id) DO UPDATE SET
          owner_agent_id = excluded.owner_agent_id, token = excluded.token,
          generation = excluded.generation, expires_at_ms = excluded.expires_at_ms, released = 0
      `,
          )
          .run(
            lease.supervisionId,
            lease.ownerAgentId,
            lease.token,
            lease.generation,
            lease.expiresAtMs,
          );
        this.database
          .prepare(
            `
          INSERT INTO supervision_owner_process_locks VALUES (?, ?, ?)
          ON CONFLICT(supervision_id) DO UPDATE SET
            token = excluded.token, file_identity = excluded.file_identity
        `,
          )
          .run(lease.supervisionId, lease.token, fileIdentity);
        return lease;
      });
      if (acquired === null) processLock.release();
      else {
        this.processLocks.set(input.supervisionId, processLock);
        publishLeaseChange(this.path);
      }
      return acquired;
    } catch (error) {
      processLock.release();
      throw error;
    }
  }

  renew(lease: SupervisionOwnerLease, nowMs: number, durationMs: number): SupervisionOwnerLease {
    const expiresAtMs = expiry(nowMs, durationMs);
    return this.transaction(() => {
      this.assertCurrent(lease, nowMs);
      this.database
        .prepare("UPDATE supervision_owner_leases SET expires_at_ms = ? WHERE supervision_id = ?")
        .run(expiresAtMs, lease.supervisionId);
      return { ...lease, expiresAtMs };
    });
  }

  /** Reads a renewal of the same private token; never acquires, extends or transfers ownership. */
  observeRenewed(lease: SupervisionOwnerLease, nowMs: number): SupervisionOwnerLease {
    const row = this.row(lease.supervisionId);
    if (
      row === undefined ||
      row.token !== lease.token ||
      row.owner_agent_id !== lease.ownerAgentId ||
      row.generation !== lease.generation ||
      row.expires_at_ms < lease.expiresAtMs
    )
      throw new SupervisionLeaseError("lease_lost");
    const observed = { ...lease, expiresAtMs: row.expires_at_ms };
    this.assertCurrent(observed, nowMs);
    return observed;
  }

  /** The synchronous effect commit holds the same fence as renewal and release. */
  commit<T>(lease: SupervisionOwnerLease, nowMs: number, effect: () => T): T {
    return this.transaction(() => {
      this.assertCurrent(lease, nowMs);
      const result = effect();
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        throw new SupervisionLeaseError("lease_invalid");
      }
      return result;
    });
  }

  /** Call only after the owner operation and every started effect have settled. */
  release(lease: SupervisionOwnerLease): void {
    const processLock = this.processLocks.get(lease.supervisionId);
    this.transaction(() => {
      this.assertToken(lease);
      if (processLock === undefined) throw new SupervisionLeaseError("lease_lost");
      // Keep the durable row locked until the native owner lock has closed.
      processLock.release();
      this.database
        .prepare("UPDATE supervision_owner_leases SET released = 1 WHERE supervision_id = ?")
        .run(lease.supervisionId);
    });
    this.processLocks.delete(lease.supervisionId);
    publishLeaseChange(this.path);
  }

  /** Advisory SQLite/WAL change notification; every waiter reattempts the fenced acquisition. */
  subscribeChanges(notify: () => void): () => void {
    let watcher: FSWatcher | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const filename = basename(this.path);
    const processListeners = processLeaseListeners.get(this.path) ?? new Set<() => void>();
    processListeners.add(notify);
    processLeaseListeners.set(this.path, processListeners);
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
      processListeners.delete(notify);
      if (processListeners.size === 0) processLeaseListeners.delete(this.path);
      this.subscriptions.delete(stop);
    };
    try {
      watcher = watch(dirname(this.path), { persistent: false }, (_event, changed) => {
        if (
          changed !== null &&
          ![filename, `${filename}-wal`, `${filename}-shm`].includes(changed.toString())
        )
          return;
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          notify();
        }, 10);
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
        notify();
      });
    } catch {
      // The admission deadline retains a bounded missed-notification recovery wake.
    }
    this.subscriptions.add(stop);
    return stop;
  }

  close(): void {
    const releasedProcessLock = this.processLocks.size > 0;
    try {
      for (const stop of [...this.subscriptions]) stop();
      this.database.close();
    } finally {
      for (const processLock of this.processLocks.values()) processLock.release();
      this.processLocks.clear();
      if (releasedProcessLock) publishLeaseChange(this.path);
    }
  }

  private processLockIdentity(row: LeaseRow): string | null {
    const record = leaseDatabaseRow(
      this.database
        .prepare(
          "SELECT token, file_identity FROM supervision_owner_process_locks WHERE supervision_id = ?",
        )
        .get(row.supervision_id),
    );
    return record?.token === row.token && typeof record.file_identity === "string"
      ? record.file_identity
      : null;
  }

  private row(supervisionId: string): LeaseRow | undefined {
    return this.database
      .prepare("SELECT * FROM supervision_owner_leases WHERE supervision_id = ?")
      .get(supervisionId) as LeaseRow | undefined;
  }

  private assertToken(lease: SupervisionOwnerLease): LeaseRow {
    const row = this.row(lease.supervisionId);
    if (
      row === undefined ||
      row.released !== 0 ||
      row.token !== lease.token ||
      row.owner_agent_id !== lease.ownerAgentId ||
      row.generation !== lease.generation ||
      row.expires_at_ms !== lease.expiresAtMs
    )
      throw new SupervisionLeaseError("lease_lost");
    if (row.token.startsWith(PROCESS_LOCK_TOKEN_PREFIX)) {
      try {
        if (
          this.processLockIdentity(row) !==
          new SupervisionProcessLock(this.path, row.supervision_id).identity()
        )
          throw new SupervisionLeaseError("lease_lost");
      } catch (error) {
        throw new SupervisionLeaseError("lease_lost", { cause: error });
      }
    }
    return row;
  }

  private assertCurrent(lease: SupervisionOwnerLease, nowMs: number): void {
    const row = this.assertToken(lease);
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= row.expires_at_ms)
      throw new SupervisionLeaseError("lease_lost");
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function expiry(nowMs: number, durationMs: number): number {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 300_000 ||
    !Number.isSafeInteger(nowMs + durationMs)
  )
    throw new SupervisionLeaseError("lease_invalid");
  return nowMs + durationMs;
}

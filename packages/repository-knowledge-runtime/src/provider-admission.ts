import { mkdir, lstat, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function database(directory: string): Promise<DatabaseSync> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const path = resolve(directory, "admission.sqlite");
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = new DatabaseSync(path);
  await chmod(path, 0o600);
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(`CREATE TABLE IF NOT EXISTS requests (
    repository_hash TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL, requested_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, provider TEXT, purpose TEXT, nonce TEXT, acquired_at INTEGER, expires_at INTEGER
  ); CREATE TABLE IF NOT EXISTS provider_pauses (
    provider TEXT PRIMARY KEY, reason TEXT NOT NULL, observation_hash TEXT NOT NULL,
    observed_at INTEGER NOT NULL, reset_at INTEGER
  )`);
  if (
    !sqliteRows(db.prepare("PRAGMA table_info(requests)").all()).some(
      (row) => row.name === "provider",
    )
  )
    db.exec("ALTER TABLE requests ADD COLUMN provider TEXT");
  if (
    !sqliteRows(db.prepare("PRAGMA table_info(requests)").all()).some(
      (row) => row.name === "purpose",
    )
  )
    db.exec("ALTER TABLE requests ADD COLUMN purpose TEXT");
  db.exec(
    "CREATE TABLE IF NOT EXISTS provider_recoveries(provider TEXT PRIMARY KEY, observation_hash TEXT NOT NULL, observed_at INTEGER NOT NULL)",
  );
  return db;
}

interface AdmissionRow {
  repository_hash: string;
  owner_pid: number;
  provider: string | null;
  purpose: string | null;
  requested_at: number;
  last_seen_at: number;
  nonce: string | null;
  acquired_at: number | null;
  expires_at: number | null;
}

function rows(db: DatabaseSync): AdmissionRow[] {
  return db
    .prepare("SELECT * FROM requests ORDER BY requested_at, repository_hash")
    .all() as unknown as AdmissionRow[];
}

/** One shared host authority admits at most two background calls, with oldest-waiter fairness. */
export async function acquireKnowledgeProviderAdmission(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  purpose?: "availability_probe";
  liveWorkPending: () => Promise<boolean>;
  directory?: string;
  now?: () => Date;
}): Promise<null | { release(): Promise<void>; observationHash: string }> {
  const liveWorkPending = await input.liveWorkPending();
  const directory =
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
  const db = await database(directory);
  const repositoryHash = sha256(resolve(input.repositoryRoot));
  const now = (input.now ?? (() => new Date()))().getTime();
  const nonce = randomUUID();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (liveWorkPending) {
      db.prepare("DELETE FROM requests WHERE repository_hash = ? AND nonce IS NULL").run(
        repositoryHash,
      );
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    const pause = sqliteRow(
      db.prepare("SELECT * FROM provider_pauses WHERE provider = ?").get(input.provider),
    );
    if (
      pause !== undefined &&
      (pause.reset_at === null || typeof pause.reset_at !== "number" || pause.reset_at > now) &&
      input.purpose !== "availability_probe"
    ) {
      db.prepare("DELETE FROM requests WHERE repository_hash = ? AND nonce IS NULL").run(
        repositoryHash,
      );
      db.exec("COMMIT");
      transactionOpen = false;
      throw new KnowledgeConvergenceRuntimeError("knowledge_provider_paused");
    }
    if (pause !== undefined && typeof pause.reset_at === "number" && pause.reset_at <= now)
      db.prepare("DELETE FROM provider_pauses WHERE provider = ?").run(input.provider);
    for (const row of rows(db)) {
      const deadline = row.expires_at ?? row.last_seen_at + 60_000;
      if (!alive(row.owner_pid) || (row.nonce === null && deadline <= now))
        db.prepare("DELETE FROM requests WHERE repository_hash = ? AND owner_pid = ?").run(
          row.repository_hash,
          row.owner_pid,
        );
    }
    if (
      rows(db).length >= 1_024 &&
      sqliteRow(
        db
          .prepare("SELECT repository_hash FROM requests WHERE repository_hash = ?")
          .get(repositoryHash),
      ) === undefined
    ) {
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    const own = rows(db).find((row) => row.repository_hash === repositoryHash);
    if (own?.nonce != null) {
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    if (own !== undefined && own.owner_pid !== process.pid && alive(own.owner_pid)) {
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    db.prepare(
      `INSERT INTO requests(repository_hash,owner_pid,requested_at,last_seen_at,provider,purpose) VALUES(?,?,?,?,?,?)
      ON CONFLICT(repository_hash) DO UPDATE SET owner_pid=excluded.owner_pid,last_seen_at=excluded.last_seen_at,provider=excluded.provider,purpose=excluded.purpose`,
    ).run(repositoryHash, process.pid, now, now, input.provider, input.purpose ?? null);
    const pending = rows(db);
    const active = pending.filter((row) => row.nonce !== null);
    const paused = new Set(
      sqliteRows(
        db
          .prepare("SELECT provider FROM provider_pauses WHERE reset_at IS NULL OR reset_at > ?")
          .all(now),
      ).map((row) => String(row.provider)),
    );
    const first = pending.find(
      (row) =>
        row.nonce === null &&
        (!paused.has(row.provider ?? "") || row.purpose === "availability_probe"),
    );
    if (active.length >= 2 || first?.repository_hash !== repositoryHash) {
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    db.prepare(
      "UPDATE requests SET nonce=?, acquired_at=?, expires_at=? WHERE repository_hash=? AND nonce IS NULL",
    ).run(nonce, now, now + 10 * 60_000, repositoryHash);
    const observationHash = sha256(
      JSON.stringify({
        repositoryHash,
        nonce,
        active: active.length + 1,
        maximum: 2,
        acquiredAt: now,
      }),
    );
    db.exec("COMMIT");
    transactionOpen = false;
    let released = false;
    return {
      observationHash,
      release: async () => {
        if (released) return;
        const fresh = await database(directory);
        try {
          fresh
            .prepare(
              "DELETE FROM requests WHERE repository_hash = ? AND nonce = ? AND owner_pid = ?",
            )
            .run(repositoryHash, nonce, process.pid);
          released = true;
        } finally {
          fresh.close();
        }
      },
    };
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/** Unknown reset times never expire by guessing; a fresh normalized observation is required. */
export async function pauseKnowledgeProvider(input: {
  provider: "codex" | "claude";
  reason: "quota" | "authentication";
  observationHash: string;
  resetAt: string | null;
  directory?: string;
  now?: Date;
}): Promise<void> {
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.observationHash) ||
    (input.resetAt !== null && !Number.isFinite(Date.parse(input.resetAt)))
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const db = await database(
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission"),
  );
  try {
    db.prepare(
      `INSERT INTO provider_pauses(provider,reason,observation_hash,observed_at,reset_at) VALUES(?,?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET reason=excluded.reason,observation_hash=excluded.observation_hash,observed_at=excluded.observed_at,reset_at=excluded.reset_at`,
    ).run(
      input.provider,
      input.reason,
      input.observationHash,
      (input.now ?? new Date()).getTime(),
      input.resetAt === null ? null : Date.parse(input.resetAt),
    );
  } finally {
    db.close();
  }
}

/** An explicit native observation can clear a pause; expiry alone clears only an observed reset. */
export async function knowledgeProviderAdmissionState(input: {
  provider: "codex" | "claude";
  directory?: string;
  now?: Date;
}): Promise<{
  paused: boolean;
  observationHash: string | null;
  resetAt: string | null;
  activeCalls: number;
  observedAt: string | null;
}> {
  const db = await database(
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission"),
  );
  try {
    const pause = sqliteRow(
      db.prepare("SELECT * FROM provider_pauses WHERE provider = ?").get(input.provider),
    );
    const now = (input.now ?? new Date()).getTime();
    return {
      paused: pause !== undefined && (pause.reset_at === null || Number(pause.reset_at) > now),
      observationHash: typeof pause?.observation_hash === "string" ? pause.observation_hash : null,
      resetAt: typeof pause?.reset_at === "number" ? new Date(pause.reset_at).toISOString() : null,
      activeCalls: rows(db).filter((row) => row.nonce !== null && alive(row.owner_pid)).length,
      observedAt:
        typeof pause?.observed_at === "number" ? new Date(pause.observed_at).toISOString() : null,
    };
  } finally {
    db.close();
  }
}

/** Compare the pause observed before a native probe; never erase a newer quota or authentication failure. */
export async function settleKnowledgeProviderProbe(input: {
  provider: "codex" | "claude";
  priorObservationHash: string | null;
  priorObservedAt: string | null;
  observationHash: string;
  directory?: string;
}): Promise<boolean> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.observationHash))
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const db = await database(
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission"),
  );
  try {
    db.exec("BEGIN IMMEDIATE");
    const current = sqliteRow(
      db.prepare("SELECT * FROM provider_pauses WHERE provider=?").get(input.provider),
    );
    if (
      current &&
      (current.observation_hash !== input.priorObservationHash ||
        new Date(Number(current.observed_at)).toISOString() !== input.priorObservedAt)
    ) {
      db.exec("COMMIT");
      return false;
    }
    db.prepare("DELETE FROM provider_pauses WHERE provider=?").run(input.provider);
    db.prepare(
      "INSERT INTO provider_recoveries VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET observation_hash=excluded.observation_hash,observed_at=excluded.observed_at",
    ).run(input.provider, input.observationHash, Date.now());
    db.exec("COMMIT");
    return true;
  } finally {
    db.close();
  }
}

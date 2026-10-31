import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { sha256 } from "@lervo/repository-knowledge";
import { sqliteRow } from "./sqlite-row.js";

export interface PracticeReservation {
  id: string;
  reserved: number;
  day: string;
  directory: string;
}

async function database(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink())
    throw new Error("Unsafe practice budget directory.");
  const path = resolve(directory, "practice-budgets.sqlite");
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error("Unsafe practice budget file.");
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  await chmod(path, 0o600);
  db.exec(
    "CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, repository TEXT NOT NULL, kind TEXT NOT NULL, tokens INTEGER NOT NULL)",
  );
  return db;
}

/** Shared host ledger across providers and repositories. Unknown usage never releases a reservation. */
export async function reservePracticeBudget(input: {
  projectId: string;
  kind: "capture" | "assessment" | "draft" | "review";
  inputBytes: number;
  outputTokens: number;
  now: Date;
  directory?: string;
}): Promise<PracticeReservation | null> {
  const directory =
    input.directory ?? resolve(homedir(), ".lervo/state/knowledge-provider-admission");
  const db = await database(directory);
  const day = input.now.toISOString().slice(0, 10);
  const reserved = input.inputBytes + input.outputTokens;
  const id = randomUUID();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM reservations WHERE day < ?").run(day);
    const total = Number(
      sqliteRow(
        db
          .prepare("SELECT coalesce(sum(tokens),0) AS tokens FROM reservations WHERE day=?")
          .get(day),
      )!.tokens,
    );
    const count = Number(
      sqliteRow(
        db
          .prepare(
            "SELECT count(*) AS count FROM reservations WHERE day=? AND repository=? AND kind=?",
          )
          .get(day, sha256(input.projectId), input.kind),
      )!.count,
    );
    const rows = Number(
      sqliteRow(db.prepare("SELECT count(*) AS count FROM reservations").get())!.count,
    );
    if (
      total + reserved > 120_000 ||
      rows >= 4096 ||
      (["draft", "review"].includes(input.kind) && count >= 3)
    ) {
      db.exec("ROLLBACK");
      return null;
    }
    db.prepare("INSERT INTO reservations VALUES (?,?,?,?,?)").run(
      id,
      day,
      sha256(input.projectId),
      input.kind,
      reserved,
    );
    db.exec("COMMIT");
    return { id, reserved, day, directory };
  } finally {
    db.close();
  }
}

export async function settlePracticeBudget(
  reservation: PracticeReservation,
  observedTokens: number | null,
): Promise<void> {
  if (observedTokens === null) return;
  const db = await database(reservation.directory);
  try {
    db.prepare("UPDATE reservations SET tokens=? WHERE id=? AND day=?").run(
      Math.max(0, Math.ceil(observedTokens)),
      reservation.id,
      reservation.day,
    );
  } finally {
    db.close();
  }
}

/** A reservation without a provider attempt consumes neither tokens nor the daily attempt count. */
export async function releaseUnattemptedPracticeBudget(
  reservation: PracticeReservation,
): Promise<void> {
  const db = await database(reservation.directory);
  try {
    db.prepare("DELETE FROM reservations WHERE id=? AND day=?").run(
      reservation.id,
      reservation.day,
    );
  } finally {
    db.close();
  }
}

// The claim log (Lervo ADE coordination, "State, events, privacy, and failure meaning"): the
// host's private record of the claims Lervo refused or deferred, from which a conversation shows
// its room lines and reconciliation keeps its bookkeeping. It is a projection, never evidence: a
// refusal's evidence is the core's `assignment.claim.refused` event, which shares the tool use ID.
import { randomBytes } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase } from "@lervo/sqlite-connection";

import { hostedLaunchRecordsPath } from "./hosted-launch-records.js";

/** The most entries one conversation keeps; the oldest go first. */
export const CLAIM_LOG_ENTRIES_PER_CONVERSATION = 512;
/** How long a hook waits for another writer before it gives the entry up rather than wait. */
const CLAIM_LOG_BUSY_MS = 250;

export type ClaimLogState = "refused" | "deferred" | "unresolved" | "resolved";

/** One refused or deferred claim. It holds no tool input, command text, or file content. */
export interface ClaimLogEntry {
  readonly claimId: string;
  readonly workspaceId: string;
  /** The provider session that made the call. */
  readonly sessionId: string;
  readonly toolUseId: string | null;
  readonly decision: "deny" | "defer";
  readonly code: string;
  /** Repository-relative, with forward slashes. */
  readonly paths: readonly string[];
  readonly holder: { readonly agentId: string; readonly workspaceId: string | null } | null;
  readonly state: ClaimLogState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NewClaimLogEntry = Omit<ClaimLogEntry, "claimId" | "state" | "createdAt" | "updatedAt">;

/** The claim log beside the hosted launch records. */
export function claimLogPath(): string {
  return resolve(dirname(hostedLaunchRecordsPath()), "claim-log.sqlite");
}

interface Row {
  claim_id: string;
  workspace_id: string;
  session_id: string;
  tool_use_id: string | null;
  decision: string;
  code: string;
  paths: string;
  holder_agent_id: string | null;
  holder_workspace_id: string | null;
  state: string;
  created_at: string;
  updated_at: string;
}

const entryOf = (row: Row): ClaimLogEntry => ({
  claimId: row.claim_id,
  workspaceId: row.workspace_id,
  sessionId: row.session_id,
  toolUseId: row.tool_use_id,
  decision: row.decision === "deny" ? "deny" : "defer",
  code: row.code,
  paths: JSON.parse(row.paths) as string[],
  holder:
    row.holder_agent_id === null
      ? null
      : { agentId: row.holder_agent_id, workspaceId: row.holder_workspace_id },
  state: row.state as ClaimLogState,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** An open claim log. Each call is one statement or one transaction. */
export class ClaimLog {
  private constructor(private readonly database: DatabaseSync) {}

  /**
   * Opens the log, creating it owner-only on first use. Hooks open it only to record a refusal or
   * a deferral, so an allowed write never touches it.
   */
  static async open(path = claimLogPath()): Promise<ClaimLog> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Created owner-only before SQLite opens it; its journal files take the same mode.
    const file = await open(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await file.close();
    const database = openSqliteDatabase(path, { busyTimeoutMs: CLAIM_LOG_BUSY_MS });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS claims (
          claim_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tool_use_id TEXT,
          decision TEXT NOT NULL,
          code TEXT NOT NULL,
          paths TEXT NOT NULL,
          holder_agent_id TEXT,
          holder_workspace_id TEXT,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS claims_tool_use ON claims (session_id, tool_use_id);
        CREATE INDEX IF NOT EXISTS claims_conversation ON claims (workspace_id, created_at);
      `);
    } catch (error) {
      database.close();
      throw error;
    }
    return new ClaimLog(database);
  }

  /**
   * Opens the log for reading only when it exists: until a claim was refused or deferred on this
   * host there is nothing to read, and a reader never creates it.
   */
  static openExisting(path = claimLogPath()): ClaimLog | null {
    let file;
    try {
      file = lstatSync(path);
    } catch {
      return null;
    }
    if (!file.isFile()) return null;
    return new ClaimLog(openSqliteDatabase(path, { busyTimeoutMs: CLAIM_LOG_BUSY_MS }));
  }

  /** Records a refusal or a deferral, and keeps the conversation's newest entries. */
  record(entry: NewClaimLogEntry, at = new Date()): ClaimLogEntry {
    const time = at.toISOString();
    const recorded: ClaimLogEntry = {
      ...entry,
      claimId: `clm_${randomBytes(12).toString("hex")}`,
      state: entry.decision === "deny" ? "refused" : "deferred",
      createdAt: time,
      updatedAt: time,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO claims (claim_id, workspace_id, session_id, tool_use_id, decision, code,
             paths, holder_agent_id, holder_workspace_id, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recorded.claimId,
          recorded.workspaceId,
          recorded.sessionId,
          recorded.toolUseId,
          recorded.decision,
          recorded.code,
          JSON.stringify(recorded.paths),
          recorded.holder?.agentId ?? null,
          recorded.holder?.workspaceId ?? null,
          recorded.state,
          time,
          time,
        );
      this.database
        .prepare(
          `DELETE FROM claims WHERE workspace_id = ? AND claim_id NOT IN (
             SELECT claim_id FROM claims WHERE workspace_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        )
        .run(recorded.workspaceId, recorded.workspaceId, CLAIM_LOG_ENTRIES_PER_CONVERSATION);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return recorded;
  }

  /** The entry a session's tool call left, or null when Lervo let it go ahead. */
  ofToolUse(sessionId: string, toolUseId: string): ClaimLogEntry | null {
    const row = this.database
      .prepare(
        `SELECT * FROM claims WHERE session_id = ? AND tool_use_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(sessionId, toolUseId) as Row | undefined;
    return row === undefined ? null : entryOf(row);
  }

  /** A session's deferrals since `since`, oldest first. */
  deferredSince(sessionId: string, since: string): ClaimLogEntry[] {
    return this.since(sessionId, "deferred", since);
  }

  /**
   * A session's refusals since `since`, oldest first, so the core records at most one
   * `assignment.claim.refused` per session, path, and holder in a turn.
   */
  refusedSince(sessionId: string, since: string): ClaimLogEntry[] {
    return this.since(sessionId, "refused", since);
  }

  /**
   * A conversation's claims that reconciliation left `unresolved`, oldest first, so the next
   * reconciliation can try each again and move it to `resolved`. At most the conversation's kept
   * entries, so the answer is bounded.
   */
  unresolvedOf(workspaceId: string): ClaimLogEntry[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM claims WHERE workspace_id = ? AND state = 'unresolved'
           ORDER BY created_at, rowid`,
        )
        .all(workspaceId) as unknown as Row[]
    ).map(entryOf);
  }

  /**
   * A session's claims that reconciliation moved to `unresolved` after `since`, oldest first, so
   * the turn that ended shows them.
   */
  unresolvedSince(sessionId: string, since: string): ClaimLogEntry[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM claims WHERE session_id = ? AND state = 'unresolved' AND updated_at > ?
           ORDER BY updated_at, rowid`,
        )
        .all(sessionId, since) as unknown as Row[]
    ).map(entryOf);
  }

  private since(sessionId: string, state: ClaimLogState, since: string): ClaimLogEntry[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM claims WHERE session_id = ? AND state = ? AND created_at > ?
           ORDER BY created_at, rowid`,
        )
        .all(sessionId, state, since) as unknown as Row[]
    ).map(entryOf);
  }

  /**
   * Moves a claim to `state`, as reconciliation decides it. Idempotent: a claim already in
   * `state` keeps its time. False when no such claim is kept.
   */
  updateState(claimId: string, state: ClaimLogState, at = new Date()): boolean {
    const known = this.database
      .prepare("SELECT state FROM claims WHERE claim_id = ?")
      .get(claimId) as { state: string } | undefined;
    if (known === undefined) return false;
    if (known.state === state) return true;
    this.database
      .prepare("UPDATE claims SET state = ?, updated_at = ? WHERE claim_id = ?")
      .run(state, at.toISOString(), claimId);
    return true;
  }

  close(): void {
    this.database.close();
  }
}

/** Records one refusal or deferral, opening the log only for it, as the pre-tool hook does. */
export async function recordClaimLogEntry(entry: NewClaimLogEntry, path = claimLogPath()) {
  const log = await ClaimLog.open(path);
  try {
    log.record(entry);
  } finally {
    log.close();
  }
}

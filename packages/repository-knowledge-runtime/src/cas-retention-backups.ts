import { lstat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";
import type { CasReferenceFile } from "./cas-retention-files.js";

/** The CLI's pre-activation backups: `<data>/event-writer-backups/schema-<n>/events.sqlite`. */
const BACKUP_DIRECTORY = "event-writer-backups";
const EVENT_COLUMNS = [
  "actor_json",
  "event_hash",
  "event_id",
  "occurred_at",
  "payload_json",
  "policy_version",
  "previous_hash",
  "project_id",
  "run_id",
  "schema_version",
  "seq",
  "session_id",
  "type",
].join();

/** Evaluates an event-writer backup's `events` rows under the live log's policy (ADR-0585). */
export interface EventWriterBackupMirror {
  /**
   * Device and inode of the live event database. A cached verdict stays valid only for that
   * database: its append-only triggers forbid rewriting a row in place, and a restored or
   * replaced database has another inode.
   */
  liveIdentity: string;
  /**
   * True only when the live snapshot holds this event at the same position with the same hash
   * and the same bytes. Such a row names nothing the live replay does not already evaluate.
   */
  mirrors(row: Readonly<Record<string, unknown>>): boolean;
  /** A plan collects eligible references that only mirrored rows name; the collector drops them. */
  released?: Set<string>;
}

function sameJson(text: unknown, value: unknown): boolean {
  return typeof text === "string" && JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
}

function sameEvent(row: Readonly<Record<string, unknown>>, live: EventEnvelope): boolean {
  return (
    Object.keys(row).sort().join() === EVENT_COLUMNS &&
    Number(row.seq) === live.seq &&
    row.event_hash === live.eventHash &&
    row.previous_hash === live.previousHash &&
    row.project_id === live.projectId &&
    row.run_id === live.runId &&
    row.session_id === live.sessionId &&
    row.type === live.type &&
    row.occurred_at === live.occurredAt &&
    Number(row.schema_version) === live.schemaVersion &&
    row.policy_version === live.policyVersion &&
    sameJson(row.actor_json, live.actor) &&
    sameJson(row.payload_json, live.payload)
  );
}

/** Any read or parse failure, or an event beyond the replayed head, keeps the row's references. */
export function eventWriterBackupMirror(
  events: Pick<OutboxStore, "get">,
  liveIdentity: string,
  headSeq: number,
  released?: Set<string>,
): EventWriterBackupMirror {
  return {
    liveIdentity,
    mirrors(row) {
      if (typeof row.event_id !== "string") return false;
      try {
        const live = events.get(row.event_id);
        return live !== null && live.seq <= headSeq && sameEvent(row, live);
      } catch {
        return false;
      }
    },
    ...(released === undefined ? {} : { released }),
  };
}

/** Attach the live-log comparison to every backup event database in the inventory. */
export async function bindEventWriterBackups(
  storage: ProjectStorage,
  headSeq: number,
  files: readonly CasReferenceFile[],
  released?: Set<string>,
): Promise<void> {
  const directory = resolve(storage.paths.data, BACKUP_DIRECTORY);
  const backups = files.filter(
    (file) =>
      file.hash === null &&
      basename(file.path) === "events.sqlite" &&
      dirname(dirname(file.path)) === directory,
  );
  if (!backups.length) return;
  const live = await lstat(storage.paths.eventDatabase).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const liveIdentity = live === null ? "absent" : `${live.dev}:${live.ino}`;
  for (const file of backups)
    file.mirror = eventWriterBackupMirror(storage.events, liveIdentity, headSeq, released);
}

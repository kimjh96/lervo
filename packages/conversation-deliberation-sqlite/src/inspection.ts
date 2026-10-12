import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import type {
  ConversationDeliberationJob,
  ConversationDeliberationNotification,
  ConversationDeliberationResumeJob,
} from "@lervo/conversation-deliberation-contract";

import { conversationDeliberationSQLiteSchemaVersion } from "./database.js";
import { ConversationDeliberationSQLiteError } from "./errors.js";
import { conversationDeliberationNotificationSchemaNames } from "./notification-database.js";
import {
  checkConversationDeliberationNotificationIntegrity,
  decodeConversationDeliberationNotification,
} from "./notification-store.js";
import { conversationDeliberationResumeSQLiteSchemaVersion } from "./resume-database.js";
import { decodeConversationDeliberationResumeJob } from "./resume-row-codec.js";
import {
  assertConversationDeliberationLookup,
  decodeConversationDeliberationJob,
} from "./row-codec.js";
import { checkConversationDeliberationQueueIntegrity } from "./store-core.js";
import { sqliteRow } from "./sqlite-row.js";

const maximumInspectionRecords = 100_000;

export interface ConversationDeliberationQueueInspection {
  start: ConversationDeliberationJob | null;
  startNotification: ConversationDeliberationNotification | null;
  resume: ConversationDeliberationResumeJob | null;
  resumeNotification: ConversationDeliberationNotification | null;
}

async function openExisting(path: string): Promise<DatabaseSync | null> {
  const absolute = resolve(path);
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The read-only conversation deliberation queue must be an existing regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const database = openSqliteDatabase(absolute, {
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  database.exec("PRAGMA query_only = ON;");
  return database;
}

function assertVersion(database: DatabaseSync, expected: number, label: string): void {
  if (sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version !== expected) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The ${label} requires an owner-managed schema migration.`,
    );
  }
}

function notification(
  database: DatabaseSync,
  operation: "start" | "resume",
  projectId: string,
  deliberationId: string,
): ConversationDeliberationNotification | null {
  const row = sqliteRow(
    database
      .prepare(
        "SELECT * FROM conversation_deliberation_notifications WHERE project_id = ? AND deliberation_id = ?",
      )
      .get(projectId, deliberationId),
  );
  return row === undefined ? null : decodeConversationDeliberationNotification(row, operation);
}

async function inspectStart(input: { path: string; projectId: string; deliberationId: string }) {
  const database = await openExisting(input.path);
  if (database === null) return { job: null, notification: null };
  try {
    assertVersion(database, conversationDeliberationSQLiteSchemaVersion, "deliberation queue");
    checkConversationDeliberationQueueIntegrity({
      database,
      table: "conversation_deliberation_jobs",
      requiredSchema: [
        "conversation_deliberation_job_identity_immutable",
        "conversation_deliberation_job_lifecycle",
        "conversation_deliberation_job_no_delete",
        "conversation_deliberation_jobs_active_lease",
        ...conversationDeliberationNotificationSchemaNames,
      ],
      maximumRecords: maximumInspectionRecords,
      label: "conversation deliberation queue",
      decode: decodeConversationDeliberationJob,
    });
    checkConversationDeliberationNotificationIntegrity({
      database,
      operation: "start",
      maximumRecords: maximumInspectionRecords,
    });
    const row = sqliteRow(
      database
        .prepare(
          "SELECT * FROM conversation_deliberation_jobs WHERE project_id = ? AND deliberation_id = ?",
        )
        .get(input.projectId, input.deliberationId),
    );
    return {
      job: row === undefined ? null : decodeConversationDeliberationJob(row),
      notification: notification(database, "start", input.projectId, input.deliberationId),
    };
  } finally {
    database.close();
  }
}

async function inspectResume(input: { path: string; projectId: string; deliberationId: string }) {
  const database = await openExisting(input.path);
  if (database === null) return { job: null, notification: null };
  try {
    assertVersion(
      database,
      conversationDeliberationResumeSQLiteSchemaVersion,
      "deliberation resume queue",
    );
    checkConversationDeliberationQueueIntegrity({
      database,
      table: "conversation_deliberation_resume_jobs",
      requiredSchema: [
        "conversation_deliberation_resume_job_identity_immutable",
        "conversation_deliberation_resume_job_lifecycle",
        "conversation_deliberation_resume_job_no_delete",
        "conversation_deliberation_resume_jobs_active_lease",
        ...conversationDeliberationNotificationSchemaNames,
      ],
      maximumRecords: maximumInspectionRecords,
      label: "conversation deliberation resume queue",
      decode: decodeConversationDeliberationResumeJob,
    });
    checkConversationDeliberationNotificationIntegrity({
      database,
      operation: "resume",
      maximumRecords: maximumInspectionRecords,
    });
    const row = sqliteRow(
      database
        .prepare(
          "SELECT * FROM conversation_deliberation_resume_jobs WHERE project_id = ? AND deliberation_id = ?",
        )
        .get(input.projectId, input.deliberationId),
    );
    return {
      job: row === undefined ? null : decodeConversationDeliberationResumeJob(row),
      notification: notification(database, "resume", input.projectId, input.deliberationId),
    };
  } finally {
    database.close();
  }
}

/** Reads current queue state without creating, migrating, leasing, or settling owner data. */
export async function inspectConversationDeliberationQueues(input: {
  startPath: string;
  resumePath: string;
  projectId: string;
  deliberationId: string;
}): Promise<ConversationDeliberationQueueInspection> {
  assertConversationDeliberationLookup(input);
  const coordinates = {
    projectId: input.projectId,
    deliberationId: input.deliberationId,
  };
  const [start, resume] = await Promise.all([
    inspectStart({ ...coordinates, path: input.startPath }),
    inspectResume({ ...coordinates, path: input.resumePath }),
  ]);
  return {
    start: start.job,
    startNotification: start.notification,
    resume: resume.job,
    resumeNotification: resume.notification,
  };
}

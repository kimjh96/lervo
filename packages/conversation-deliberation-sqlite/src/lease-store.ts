import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  conversationDeliberationPatterns,
  type ConversationDeliberationSummary,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationSummary,
} from "./row-codec.js";

type QueueTable = "conversation_deliberation_jobs" | "conversation_deliberation_resume_jobs";

interface QueueJob {
  projectId: string;
  sourceEventId: string;
  deliberationId: string;
}

export interface LeaseStoreConfiguration<TJob extends QueueJob, TFailureCode extends string> {
  table: QueueTable;
  leasePrefix: "cdl" | "cdr";
  expiredFailureCode: TFailureCode;
  label: string;
  decode(row: Record<string, unknown>): TJob;
}

function rollback(database: DatabaseSync, error: unknown, label: string): never {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new ConversationDeliberationSQLiteError(
      "write_failed",
      `${label} transaction and rollback both failed.`,
      { cause: new AggregateError([error, rollbackError]) },
    );
  }
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError("write_failed", `${label} transaction failed.`, {
    cause: error,
  });
}

function writeError(error: unknown, message: string): never {
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError("write_failed", message, { cause: error });
}

export function assertConversationDeliberationLeaseOptions(
  workerId: string,
  leaseDurationMs: number,
  label: string,
): void {
  if (!conversationDeliberationPatterns.workerId.test(workerId)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${label} lease configuration is invalid.`,
    );
  }
  assertConversationDeliberationLeaseDuration(leaseDurationMs, label);
}

function assertConversationDeliberationLeaseDuration(leaseDurationMs: number, label: string): void {
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 10_000 ||
    leaseDurationMs > 60 * 60_000
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${label} lease duration is invalid.`,
    );
  }
}

export function claimConversationDeliberationJob<
  TJob extends QueueJob,
  TFailureCode extends string,
>(input: {
  database: DatabaseSync;
  workerId: string;
  claimedAt: string;
  leaseDurationMs: number;
  configuration: LeaseStoreConfiguration<TJob, TFailureCode>;
}): { leaseId: string; job: TJob } | null {
  const { database, configuration } = input;
  const claimedAtMs = conversationDeliberationMilliseconds(
    input.claimedAt,
    `${configuration.label} claim`,
  );
  assertConversationDeliberationLeaseOptions(
    input.workerId,
    input.leaseDurationMs,
    configuration.label,
  );
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(
        `
      UPDATE ${configuration.table} SET
        state = 'uncertain', lease_id = NULL, lease_owner = NULL,
        lease_expires_at = NULL, lease_expires_at_ms = NULL,
        failure_code = ?, terminal_at = ?
      WHERE state = 'leased' AND lease_expires_at_ms <= ?
    `,
      )
      .run(configuration.expiredFailureCode, input.claimedAt, claimedAtMs);
    const row = database
      .prepare(
        `
      SELECT * FROM ${configuration.table}
      WHERE state = 'queued' AND requested_at_ms <= ?
      ORDER BY requested_at_ms ASC, deliberation_id ASC LIMIT 1
    `,
      )
      .get(claimedAtMs);
    if (row === undefined) {
      database.exec("COMMIT;");
      return null;
    }
    const job = configuration.decode(row);
    const leaseId = `${configuration.leasePrefix}_${randomBytes(24).toString("base64url")}`;
    const leaseExpiresAtMs = claimedAtMs + input.leaseDurationMs;
    const updated = database
      .prepare(
        `
      UPDATE ${configuration.table} SET
        state = 'leased', attempt_count = attempt_count + 1,
        lease_id = ?, lease_owner = ?, lease_expires_at = ?, lease_expires_at_ms = ?
      WHERE project_id = ? AND source_event_id = ? AND state = 'queued'
    `,
      )
      .run(
        leaseId,
        input.workerId,
        new Date(leaseExpiresAtMs).toISOString(),
        leaseExpiresAtMs,
        job.projectId,
        job.sourceEventId,
      );
    if (updated.changes !== 1)
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        `Could not acquire the ${configuration.label} lease.`,
      );
    const leased = database
      .prepare(
        `
      SELECT * FROM ${configuration.table}
      WHERE project_id = ? AND deliberation_id = ?
    `,
      )
      .get(job.projectId, job.deliberationId);
    database.exec("COMMIT;");
    return { leaseId, job: configuration.decode(leased!) };
  } catch (error) {
    rollback(database, error, configuration.label);
  }
}

export function renewConversationDeliberationJob(input: {
  database: DatabaseSync;
  deliberationId: string;
  leaseId: string;
  renewedAt: string;
  leaseDurationMs: number;
  configuration: LeaseStoreConfiguration<QueueJob, string>;
}): void {
  const { database, configuration } = input;
  const renewedAtMs = conversationDeliberationMilliseconds(
    input.renewedAt,
    `${configuration.label} lease renewal`,
  );
  assertConversationDeliberationLeaseDuration(input.leaseDurationMs, configuration.label);
  const expiresAtMs = renewedAtMs + input.leaseDurationMs;
  try {
    const result = database
      .prepare(
        `
      UPDATE ${configuration.table} SET lease_expires_at = ?, lease_expires_at_ms = ?
      WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
        AND lease_expires_at_ms > ?
    `,
      )
      .run(
        new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        input.deliberationId,
        input.leaseId,
        renewedAtMs,
      );
    if (result.changes !== 1)
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        `Could not renew the ${configuration.label} lease.`,
      );
  } catch (error) {
    writeError(error, `Could not store the ${configuration.label} lease renewal.`);
  }
}

export function settleConversationDeliberationJob(input: {
  database: DatabaseSync;
  deliberationId: string;
  leaseId: string;
  settledAt: string;
  summary: ConversationDeliberationSummary;
  configuration: LeaseStoreConfiguration<QueueJob, string>;
}): void {
  const { database, configuration } = input;
  const settledAtMs = conversationDeliberationMilliseconds(
    input.settledAt,
    `${configuration.label} settlement`,
  );
  const encoded = JSON.stringify(input.summary);
  decodeConversationDeliberationSummary(encoded, input.deliberationId);
  if (
    input.summary.status !== "converged" &&
    input.summary.status !== "no_consensus" &&
    input.summary.status !== "failed"
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The ${configuration.label} result is not terminal.`,
    );
  }
  try {
    const result = database
      .prepare(
        `
      UPDATE ${configuration.table} SET
        state = 'settled', lease_id = NULL, lease_owner = NULL,
        lease_expires_at = NULL, lease_expires_at_ms = NULL,
        summary_json = ?, terminal_at = ?
      WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
        AND requested_at_ms <= ?
    `,
      )
      .run(encoded, input.settledAt, input.deliberationId, input.leaseId, settledAtMs);
    if (result.changes !== 1)
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        `The ${configuration.label} settlement lease differs.`,
      );
  } catch (error) {
    writeError(error, `Could not store the ${configuration.label} settlement result.`);
  }
}

export function markConversationDeliberationJobUncertain<TFailureCode extends string>(input: {
  database: DatabaseSync;
  deliberationId: string;
  leaseId: string;
  failedAt: string;
  failureCode: TFailureCode;
  configuration: LeaseStoreConfiguration<QueueJob, TFailureCode>;
}): void {
  const { database, configuration } = input;
  const failedAtMs = conversationDeliberationMilliseconds(
    input.failedAt,
    `${configuration.label} failure`,
  );
  try {
    const result = database
      .prepare(
        `
      UPDATE ${configuration.table} SET
        state = 'uncertain', lease_id = NULL, lease_owner = NULL,
        lease_expires_at = NULL, lease_expires_at_ms = NULL,
        failure_code = ?, terminal_at = ?
      WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
        AND requested_at_ms <= ?
    `,
      )
      .run(input.failureCode, input.failedAt, input.deliberationId, input.leaseId, failedAtMs);
    if (result.changes !== 1)
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        `The ${configuration.label} uncertain-state lease differs.`,
      );
  } catch (error) {
    writeError(error, `Could not store the ${configuration.label} uncertain state.`);
  }
}

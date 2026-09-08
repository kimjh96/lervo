import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import type { ConversationInboundEvent } from "@lervo/schemas";

import { inbound, text } from "./codec.js";
import { InteractionSQLiteError } from "./errors.js";
import { renewConversationInboxLease } from "./inbox-lease.js";

export type SQLiteInboxClaim =
  | { status: "claimed"; leaseId: string; attemptCount: number }
  | { status: "busy" }
  | { status: "completed" };

export interface SQLiteInboxCoordinate {
  event: ConversationInboundEvent;
  policyId: string;
  roleId: string;
  status: "pending" | "leased" | "completed";
}

export interface SQLiteReadyInbound {
  event: ConversationInboundEvent;
  policyId: string;
  roleId: string;
}

function milliseconds(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InteractionSQLiteError("integrity_failed", `${label} time is invalid.`);
  }
  return result;
}

function failureCode(value: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The Interaction failure code is invalid.",
    );
  }
}

function policyId(value: string): void {
  if (!/^cpp_[a-f0-9]{64}$/.test(value)) {
    throw new InteractionSQLiteError("integrity_failed", "The participation policy ID is invalid.");
  }
}

function roleId(value: string): void {
  if (value.length > 100 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new InteractionSQLiteError("integrity_failed", "The participation role ID is invalid.");
  }
}

export class ConversationInboxSQLiteRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly maxRecords: number,
  ) {}

  claim(input: {
    event: ConversationInboundEvent;
    policyId: string;
    roleId: string;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): SQLiteInboxClaim {
    policyId(input.policyId);
    roleId(input.roleId);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workerId) ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 300_000
    )
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation inbox lease configuration is invalid.",
      );
    const claimedAtMs = milliseconds(input.claimedAt, "Conversation claim");
    const row = this.database
      .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
      .get(input.event.eventId, input.roleId);
    if (row === undefined) return this.insert(input, claimedAtMs);
    const stored = inbound(row);
    if (canonicalJson(stored) !== canonicalJson(input.event)) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "A different source exists for the same conversation event ID.",
      );
    }
    if (row.status === "completed") return { status: "completed" };
    if (text(row, "policy_id") !== input.policyId) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The participation policy of an in-progress conversation interaction changed.",
      );
    }
    const availableAtMs = row.available_at_ms;
    const leaseExpiresAtMs = row.lease_expires_at_ms;
    if (
      (row.status === "pending" &&
        typeof availableAtMs === "number" &&
        availableAtMs > claimedAtMs) ||
      (row.status === "leased" &&
        typeof leaseExpiresAtMs === "number" &&
        leaseExpiresAtMs > claimedAtMs)
    )
      return { status: "busy" };
    return this.acquire(input, claimedAtMs);
  }

  private insert(
    input: {
      event: ConversationInboundEvent;
      policyId: string;
      roleId: string;
      workerId: string;
      leaseDurationMs: number;
    },
    claimedAtMs: number,
  ): SQLiteInboxClaim {
    const count = this.database
      .prepare("SELECT COUNT(*) AS count FROM conversation_inbox")
      .get()?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count)) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation inbox count is invalid.",
      );
    }
    if (count >= this.maxRecords) {
      throw new InteractionSQLiteError(
        "capacity_exceeded",
        "The conversation inbox capacity was exceeded.",
      );
    }
    const leaseId = `cil_${randomBytes(24).toString("base64url")}`;
    this.database
      .prepare(
        `
      INSERT INTO conversation_inbox (
        event_id, policy_id, role_id, integration_id, project_id, conversation_id, event_json,
        status, available_at_ms, attempt_count, lease_id, lease_owner,
        lease_expires_at_ms, last_failure_code, last_failed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'leased', ?, 1, ?, ?, ?, NULL, NULL)
    `,
      )
      .run(
        input.event.eventId,
        input.policyId,
        input.roleId,
        input.event.target.integrationId,
        input.event.target.projectId,
        input.event.target.conversationId,
        canonicalJson(input.event),
        claimedAtMs,
        leaseId,
        input.workerId,
        claimedAtMs + input.leaseDurationMs,
      );
    return { status: "claimed", leaseId, attemptCount: 1 };
  }

  private acquire(
    input: {
      event: ConversationInboundEvent;
      roleId: string;
      workerId: string;
      leaseDurationMs: number;
    },
    claimedAtMs: number,
  ): SQLiteInboxClaim {
    const leaseId = `cil_${randomBytes(24).toString("base64url")}`;
    const updated = this.database
      .prepare(
        `
      UPDATE conversation_inbox SET
        status = 'leased', attempt_count = attempt_count + 1,
        lease_id = ?, lease_owner = ?, lease_expires_at_ms = ?
      WHERE event_id = ? AND role_id = ? AND status != 'completed'
    `,
      )
      .run(
        leaseId,
        input.workerId,
        claimedAtMs + input.leaseDurationMs,
        input.event.eventId,
        input.roleId,
      );
    if (updated.changes !== 1) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "Could not acquire the conversation inbox lease.",
      );
    }
    const attemptCount = this.database
      .prepare("SELECT attempt_count FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
      .get(input.event.eventId, input.roleId)?.attempt_count;
    if (typeof attemptCount !== "number" || !Number.isSafeInteger(attemptCount)) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation attempt count is invalid.",
      );
    }
    return { status: "claimed", leaseId, attemptCount };
  }

  leasedEvent(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
  }): ConversationInboundEvent {
    policyId(input.policyId);
    roleId(input.roleId);
    const row = this.database
      .prepare(
        "SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ? AND policy_id = ?",
      )
      .get(input.eventId, input.roleId, input.policyId);
    if (row === undefined || row.status !== "leased" || row.lease_id !== input.leaseId) {
      throw new InteractionSQLiteError("lease_mismatch", "The conversation inbox lease differs.");
    }
    return inbound(row);
  }

  renew(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  }): void {
    renewConversationInboxLease(this.database, input);
  }

  complete(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    terminalFailure?: { failureCode: string; failedAt: string };
  }): void {
    const terminalFailureCode = input.terminalFailure?.failureCode ?? null;
    const terminalFailedAtMs =
      input.terminalFailure === undefined
        ? null
        : milliseconds(input.terminalFailure.failedAt, "Conversation terminal failure");
    if (terminalFailureCode !== null) failureCode(terminalFailureCode);
    const updated = this.database
      .prepare(
        `
      UPDATE conversation_inbox SET status = 'completed',
        lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL,
        last_failure_code = COALESCE(?, last_failure_code),
        last_failed_at_ms = COALESCE(?, last_failed_at_ms)
      WHERE event_id = ? AND role_id = ? AND policy_id = ?
        AND lease_id = ? AND status = 'leased'
    `,
      )
      .run(
        terminalFailureCode,
        terminalFailedAtMs,
        input.eventId,
        input.roleId,
        input.policyId,
        input.leaseId,
      );
    if (updated.changes !== 1) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "Could not store the conversation inbox completion state.",
      );
    }
  }

  reschedule(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): void {
    policyId(input.policyId);
    roleId(input.roleId);
    const failedAtMs = milliseconds(input.failedAt, "Conversation failure");
    const availableAtMs = milliseconds(input.availableAt, "Conversation retry");
    failureCode(input.failureCode);
    if (availableAtMs < failedAtMs) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation retry is earlier than the failure.",
      );
    }
    const result = this.database
      .prepare(
        `
      UPDATE conversation_inbox SET status = 'pending', available_at_ms = ?,
        lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL,
        last_failure_code = ?, last_failed_at_ms = ?
      WHERE event_id = ? AND role_id = ? AND policy_id = ?
        AND lease_id = ? AND status = 'leased'
    `,
      )
      .run(
        availableAtMs,
        input.failureCode,
        failedAtMs,
        input.eventId,
        input.roleId,
        input.policyId,
        input.leaseId,
      );
    if (result.changes !== 1) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "The conversation inbox retry lease differs.",
      );
    }
  }

  ready(input: {
    integrationId: string;
    policyId: string;
    roleId: string;
    at: string;
    limit: number;
  }): SQLiteReadyInbound[] {
    const atMs = milliseconds(input.at, "Conversation retry query");
    policyId(input.policyId);
    roleId(input.roleId);
    if (
      input.integrationId.length < 1 ||
      input.integrationId.length > 128 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation retry query limit is invalid.",
      );
    }
    return this.database
      .prepare(
        `
      SELECT * FROM conversation_inbox
      WHERE integration_id = ? AND policy_id = ? AND role_id = ? AND (
        (status = 'pending' AND available_at_ms <= ?)
        OR (status = 'leased' AND lease_expires_at_ms <= ?)
      )
      ORDER BY available_at_ms, event_id, role_id
      LIMIT ?
    `,
      )
      .all(input.integrationId, input.policyId, input.roleId, atMs, atMs, input.limit)
      .map((row) => {
        policyId(text(row, "policy_id"));
        roleId(text(row, "role_id"));
        return {
          event: inbound(row),
          policyId: text(row, "policy_id"),
          roleId: text(row, "role_id"),
        };
      });
  }

  auditAll(): SQLiteInboxCoordinate[] {
    return this.database
      .prepare("SELECT * FROM conversation_inbox ORDER BY event_id, role_id")
      .all()
      .map((row) => {
        policyId(text(row, "policy_id"));
        roleId(text(row, "role_id"));
        return {
          event: inbound(row),
          policyId: text(row, "policy_id"),
          roleId: text(row, "role_id"),
          status: text(row, "status") as SQLiteInboxCoordinate["status"],
        };
      });
  }
}

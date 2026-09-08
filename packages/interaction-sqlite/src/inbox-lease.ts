import type { DatabaseSync } from "node:sqlite";

import { InteractionSQLiteError } from "./errors.js";

export function renewConversationInboxLease(
  database: DatabaseSync,
  input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  },
): void {
  const renewedAtMs = Date.parse(input.renewedAt);
  if (
    !/^cpp_[a-f0-9]{64}$/u.test(input.policyId) ||
    input.roleId.length > 100 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(input.roleId) ||
    !Number.isSafeInteger(renewedAtMs) ||
    renewedAtMs < 0 ||
    !Number.isSafeInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 300_000
  ) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The conversation inbox renewal configuration is invalid.",
    );
  }
  const updated = database
    .prepare(
      `UPDATE conversation_inbox SET lease_expires_at_ms = ?
        WHERE event_id = ? AND role_id = ? AND policy_id = ?
          AND lease_id = ? AND status = 'leased'`,
    )
    .run(
      renewedAtMs + input.leaseDurationMs,
      input.eventId,
      input.roleId,
      input.policyId,
      input.leaseId,
    );
  if (updated.changes !== 1) {
    throw new InteractionSQLiteError(
      "lease_mismatch",
      "Could not renew the conversation inbox lease.",
    );
  }
}

import type { DatabaseSync } from "node:sqlite";

import type { HubPolicyRenewalHead } from "@lervo/hub-policy";

import { parsePolicyApproval, parsePolicySnapshot } from "./policy-codec.js";
import { stringField } from "./row-codec.js";
import { sqliteRows } from "./sqlite-row.js";

/**
 * ADR-0609: every project's current snapshot with the count of approvals that still bind it.
 * Approvals are reparsed against their snapshot, so a corrupt source fails instead of renewing.
 */
export function readPolicyRenewalHeads(database: DatabaseSync, at: string): HubPolicyRenewalHead[] {
  const heads = sqliteRows(
    database
      .prepare(
        `
      SELECT head.destination_id, head.sequence, head.snapshot_id, head.envelope_json
      FROM hub_policy_snapshots AS head
      WHERE head.sequence = (
        SELECT MAX(other.sequence) FROM hub_policy_snapshots AS other
        WHERE other.destination_id = head.destination_id AND other.project_id = head.project_id
      )
      ORDER BY head.destination_id, head.project_id
    `,
      )
      .all(),
  );
  const approvals = database.prepare(`
    SELECT approval.approval_id, approval.snapshot_id, approval.command_id, approval.envelope_json
    FROM hub_policy_approvals AS approval
    WHERE approval.destination_id = ? AND approval.snapshot_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM hub_policy_revocations AS revocation
        WHERE revocation.approval_id = approval.approval_id
      )
  `);
  const atMs = Date.parse(at);
  return heads.map((row) => {
    const destinationId = stringField(row, "destination_id");
    const envelope = parsePolicySnapshot(row);
    const liveApprovalCount = sqliteRows(
      approvals.all(destinationId, envelope.snapshot.snapshotId),
    ).filter(
      (approval) => Date.parse(parsePolicyApproval(approval, envelope).approval.expiresAt) > atMs,
    ).length;
    return { destinationId, envelope, liveApprovalCount };
  });
}

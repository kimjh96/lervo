import type { DatabaseSync } from "node:sqlite";

import { HubPolicyError } from "@lervo/hub-policy";
import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertSignedPolicyApproval,
  assertSignedPolicyApprovalRevocation,
  assertSignedPolicySnapshot,
} from "@lervo/policy-contract";
import type {
  RemoteCommandTarget,
  SignedPolicyApproval,
  SignedPolicyApprovalRevocation,
  SignedPolicySnapshot,
} from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import { integerField, parseJson, stringField, type SQLiteRow } from "./row-codec.js";

export const MAX_POLICY_APPROVALS = 64;
export const MAX_POLICY_REVOCATIONS = 64;

export function assertPolicyPublishedAt(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new HubPolicyError("invalid_policy_request", "Policy publishedAt is invalid.");
  }
}

export function assertRegisteredPolicyProject(
  database: DatabaseSync,
  destinationId: string,
  target: RemoteCommandTarget,
): void {
  const row = database
    .prepare(
      `
    SELECT identity_hash FROM hub_projects WHERE destination_id = ? AND project_id = ?
  `,
    )
    .get(destinationId, target.projectId);
  if (row === undefined) {
    throw new HubPolicyError(
      "policy_registration_required",
      "The policy target project is not registered with the Hub.",
    );
  }
  if (stringField(row, "identity_hash") !== target.projectIdentityHash) {
    throw new HubPolicyError(
      "policy_identity_mismatch",
      "The policy target identity differs from the Hub registration.",
    );
  }
}

export function parsePolicySnapshot(row: SQLiteRow): SignedPolicySnapshot {
  const envelope = parseJson(stringField(row, "envelope_json")) as SignedPolicySnapshot;
  try {
    assertSignedPolicySnapshot(envelope);
  } catch (error) {
    throw new HubSyncStoreError("integrity_failed", "The Hub policy snapshot source is invalid.", {
      cause: error,
    });
  }
  if (
    envelope.snapshot.snapshotId !== stringField(row, "snapshot_id") ||
    envelope.snapshot.sequence !== integerField(row, "sequence")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The duplicate Hub policy snapshot coordinates differ.",
    );
  }
  return structuredClone(envelope);
}

export function assertPolicySnapshotTarget(
  envelope: SignedPolicySnapshot,
  target: RemoteCommandTarget,
): void {
  if (
    envelope.snapshot.target.projectId !== target.projectId ||
    envelope.snapshot.target.projectIdentityHash !== target.projectIdentityHash
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub policy snapshot target differs from the project.",
    );
  }
}

export function parsePolicyApproval(
  row: SQLiteRow,
  snapshot: SignedPolicySnapshot,
): SignedPolicyApproval {
  const envelope = parseJson(stringField(row, "envelope_json")) as SignedPolicyApproval;
  try {
    assertSignedPolicyApproval(envelope);
    assertPolicyApproval({ approval: envelope.approval, snapshot: snapshot.snapshot });
  } catch (error) {
    throw new HubSyncStoreError("integrity_failed", "The Hub policy approval source is invalid.", {
      cause: error,
    });
  }
  if (
    envelope.approval.approvalId !== stringField(row, "approval_id") ||
    envelope.approval.snapshotId !== stringField(row, "snapshot_id") ||
    envelope.approval.commandId !== stringField(row, "command_id")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The duplicate Hub policy approval coordinates differ.",
    );
  }
  return structuredClone(envelope);
}

export function parsePolicyRevocation(
  row: SQLiteRow,
  approval: SignedPolicyApproval,
): SignedPolicyApprovalRevocation {
  const envelope = parseJson(stringField(row, "envelope_json")) as SignedPolicyApprovalRevocation;
  try {
    assertSignedPolicyApprovalRevocation(envelope);
    assertPolicyApprovalRevocation({
      revocation: envelope.revocation,
      approval: approval.approval,
    });
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub policy revocation source is invalid.",
      {
        cause: error,
      },
    );
  }
  if (
    envelope.revocation.revocationId !== stringField(row, "revocation_id") ||
    envelope.revocation.approvalId !== stringField(row, "approval_id")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The duplicate Hub policy revocation coordinates differ.",
    );
  }
  return structuredClone(envelope);
}

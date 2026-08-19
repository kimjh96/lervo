import {
  assertPolicySnapshot,
  assertSignedPolicyApproval,
  assertSignedPolicyApprovalRevocation,
  assertSignedPolicySnapshot,
  calculatePolicySnapshotHash,
} from "@lervo/policy-contract";
import {
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { PolicySQLiteError } from "./errors.js";

function parse<T>(json: unknown, assertValue: (value: T) => void): T {
  if (typeof json !== "string") throw new PolicySQLiteError("integrity_failed", "policy JSON row가 유효하지 않습니다.");
  let value: unknown;
  try { value = JSON.parse(json); } catch (error) {
    throw new PolicySQLiteError("integrity_failed", "policy JSON row를 읽을 수 없습니다.", { cause: error });
  }
  try { assertValue(value as T); } catch (error) {
    throw new PolicySQLiteError("integrity_failed", "policy JSON row가 계약을 통과하지 못했습니다.", { cause: error });
  }
  return structuredClone(value as T);
}

export function decodeSnapshotRow(row: Record<string, unknown>): SignedPolicySnapshot {
  const envelope = parse(row.envelope_json, assertSignedPolicySnapshot);
  assertPolicySnapshot(envelope.snapshot);
  if (
    row.snapshot_id !== envelope.snapshot.snapshotId ||
    row.sequence !== envelope.snapshot.sequence ||
    row.previous_snapshot_id !== envelope.snapshot.previousSnapshotId ||
    row.snapshot_hash !== calculatePolicySnapshotHash(envelope.snapshot) ||
    row.issued_at_ms !== Date.parse(envelope.snapshot.issuedAt) ||
    row.expires_at_ms !== Date.parse(envelope.snapshot.expiresAt)
  ) throw new PolicySQLiteError("integrity_failed", "policy snapshot row 좌표가 원본과 다릅니다.");
  return envelope;
}

export function decodeApprovalRow(row: Record<string, unknown>): SignedPolicyApproval {
  const envelope = parse(row.envelope_json, assertSignedPolicyApproval);
  const approval = envelope.approval;
  if (
    row.approval_id !== approval.approvalId || row.snapshot_id !== approval.snapshotId ||
    row.command_id !== approval.commandId || row.command_hash !== approval.commandHash ||
    row.command_signer_key_id !== approval.commandSignerKeyId ||
    row.capability !== approval.capability || row.granted_at_ms !== Date.parse(approval.grantedAt) ||
    row.expires_at_ms !== Date.parse(approval.expiresAt)
  ) throw new PolicySQLiteError("integrity_failed", "policy approval row 좌표가 원본과 다릅니다.");
  return envelope;
}

export function decodeRevocationRow(row: Record<string, unknown>): SignedPolicyApprovalRevocation {
  const envelope = parse(row.envelope_json, assertSignedPolicyApprovalRevocation);
  if (
    row.revocation_id !== envelope.revocation.revocationId ||
    row.approval_id !== envelope.revocation.approvalId ||
    row.revoked_at_ms !== Date.parse(envelope.revocation.revokedAt)
  ) throw new PolicySQLiteError("integrity_failed", "policy revocation row 좌표가 원본과 다릅니다.");
  return envelope;
}

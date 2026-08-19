import { canonicalJson } from "@lervo/event-contract";
import {
  assertRemoteCommand,
  calculateRemoteCommandHash,
} from "@lervo/remote-command-contract";
import {
  type PolicyApproval,
  type PolicyApprovalRevocation,
  type PolicySnapshot,
  type RemoteCommand,
  validateSchema,
} from "@lervo/schemas";

import { PolicyContractError } from "./errors.js";
import { clone, sameTarget, sha256 } from "./shared.js";
import { assertPolicySnapshot, calculatePolicySnapshotHash } from "./snapshot.js";

type PolicyApprovalContent = Omit<PolicyApproval, "approvalId">;
type PolicyRevocationContent = Omit<PolicyApprovalRevocation, "revocationId">;

export function createPolicyApproval(input: {
  snapshot: PolicySnapshot;
  command: RemoteCommand;
  commandSignerKeyId: string;
  capability: PolicyApproval["capability"];
  approverSubjectHash: string;
  grantedAt: string;
  expiresAt: string;
}): PolicyApproval {
  assertPolicySnapshot(input.snapshot);
  assertRemoteCommand(input.command);
  const content: PolicyApprovalContent = {
    schemaVersion: 1,
    target: clone(input.snapshot.target),
    snapshotId: input.snapshot.snapshotId,
    snapshotHash: calculatePolicySnapshotHash(input.snapshot),
    commandId: input.command.commandId,
    commandHash: calculateRemoteCommandHash(input.command),
    commandSignerKeyId: input.commandSignerKeyId,
    capability: input.capability,
    approverSubjectHash: input.approverSubjectHash,
    grantedAt: input.grantedAt,
    expiresAt: input.expiresAt,
  };
  const approval: PolicyApproval = {
    ...content,
    approvalId: `apr_${sha256(canonicalJson(content)).slice("sha256:".length)}`,
  };
  assertPolicyApproval({ approval, snapshot: input.snapshot, command: input.command });
  return clone(approval);
}

export function assertPolicyApproval(input: {
  approval: PolicyApproval;
  snapshot: PolicySnapshot;
  command?: RemoteCommand;
  commandSignerKeyId?: string;
}): void {
  const { approval, snapshot } = input;
  assertPolicySnapshot(snapshot);
  if (!validateSchema("policyApproval", approval).valid) {
    throw new PolicyContractError("invalid_policy_approval", "policy approval 계약이 유효하지 않습니다.");
  }
  const { approvalId: _approvalId, ...content } = approval;
  if (
    approval.approvalId !== `apr_${sha256(canonicalJson(content)).slice("sha256:".length)}` ||
    !sameTarget(approval.target, snapshot.target) ||
    approval.snapshotId !== snapshot.snapshotId ||
    approval.snapshotHash !== calculatePolicySnapshotHash(snapshot) ||
    Date.parse(approval.grantedAt) < Date.parse(snapshot.issuedAt) ||
    Date.parse(approval.expiresAt) <= Date.parse(approval.grantedAt) ||
    Date.parse(approval.expiresAt) > Date.parse(snapshot.expiresAt)
  ) {
    throw new PolicyContractError(
      "invalid_policy_approval",
      "policy approval ID, 대상, snapshot 또는 기간이 원본과 다릅니다.",
    );
  }
  if (input.command !== undefined) {
    assertRemoteCommand(input.command);
    if (
      !sameTarget(approval.target, input.command.target) ||
      approval.commandId !== input.command.commandId ||
      approval.commandHash !== calculateRemoteCommandHash(input.command) ||
      (input.commandSignerKeyId !== undefined &&
        approval.commandSignerKeyId !== input.commandSignerKeyId) ||
      Date.parse(approval.expiresAt) > Date.parse(input.command.expiresAt)
    ) {
      throw new PolicyContractError(
        "invalid_policy_approval",
        "policy approval command 좌표나 기간이 원본과 다릅니다.",
      );
    }
  }
}

export function createPolicyApprovalRevocation(input: {
  approval: PolicyApproval;
  revokedAt: string;
  reasonCode: PolicyApprovalRevocation["reasonCode"];
}): PolicyApprovalRevocation {
  if (!validateSchema("policyApproval", input.approval).valid) {
    throw new PolicyContractError("invalid_policy_revocation", "철회할 policy approval이 유효하지 않습니다.");
  }
  const content: PolicyRevocationContent = {
    schemaVersion: 1,
    target: clone(input.approval.target),
    approvalId: input.approval.approvalId,
    revokedAt: input.revokedAt,
    reasonCode: input.reasonCode,
  };
  const revocation: PolicyApprovalRevocation = {
    ...content,
    revocationId: `apv_${sha256(canonicalJson(content)).slice("sha256:".length)}`,
  };
  assertPolicyApprovalRevocation({ revocation, approval: input.approval });
  return clone(revocation);
}

export function assertPolicyApprovalRevocation(input: {
  revocation: PolicyApprovalRevocation;
  approval: PolicyApproval;
}): void {
  if (
    !validateSchema("policyApprovalRevocation", input.revocation).valid ||
    !validateSchema("policyApproval", input.approval).valid
  ) {
    throw new PolicyContractError("invalid_policy_revocation", "policy approval revocation 계약이 유효하지 않습니다.");
  }
  const { revocationId: _revocationId, ...content } = input.revocation;
  if (
    input.revocation.revocationId !==
      `apv_${sha256(canonicalJson(content)).slice("sha256:".length)}` ||
    input.revocation.approvalId !== input.approval.approvalId ||
    !sameTarget(input.revocation.target, input.approval.target) ||
    Date.parse(input.revocation.revokedAt) < Date.parse(input.approval.grantedAt)
  ) {
    throw new PolicyContractError(
      "invalid_policy_revocation",
      "policy approval revocation ID, 대상 또는 시각이 원본과 다릅니다.",
    );
  }
}

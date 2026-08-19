import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertPolicySnapshot,
  policySignatureBytes,
} from "@lervo/policy-contract";
import {
  assertRemoteCommand,
} from "@lervo/remote-command-contract";
import { validateSchema } from "@lervo/schemas";

import { verifyPolicyEnvelope } from "./bundle-verifier.js";
import { PolicyRuntimeError } from "./errors.js";
import {
  type ManagedRunApprovalVerificationInput,
  type ManagedRunApprovalVerificationResult,
  type ManagedRunApprovalVerifier,
  type PolicyStateStore,
  type PolicyTrustStore,
} from "./types.js";

const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z]:[\\/]).+/u;

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const first = [...left].sort();
  const second = [...right].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function validPaths(paths: readonly string[]): boolean {
  return paths.length >= 1 && paths.length <= 16 &&
    new Set(paths).size === paths.length && paths.every((path) => PATH_PATTERN.test(path));
}

export class PolicyManagedRunApprovalVerifier implements ManagedRunApprovalVerifier {
  constructor(private readonly options: {
    store: PolicyStateStore;
    trustStore: PolicyTrustStore;
  }) {}

  async verify(
    input: ManagedRunApprovalVerificationInput,
  ): Promise<ManagedRunApprovalVerificationResult> {
    if (
      !validateSchema("managedRunApprovalAuthorization", input.authorization).valid ||
      !Number.isFinite(Date.parse(input.evaluatedAt)) ||
      !/^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.runId) ||
      !/^ses_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.sessionId) ||
      !/^sha256:[a-f0-9]{64}$/.test(input.requestDigest) ||
      !validPaths(input.expectedPaths) ||
      (input.requestedPath !== null && !PATH_PATTERN.test(input.requestedPath))
    ) throw new PolicyRuntimeError("policy_evaluation_failed", "managed run approval 검증 입력이 유효하지 않습니다.");

    const command = input.authorization.command;
    assertRemoteCommand(command);
    const evaluatedAtMs = Date.parse(input.evaluatedAt);
    if (
      command.target.projectId !== input.projectId ||
      command.action.roleId !== input.roleId ||
      command.action.provider !== input.provider ||
      command.action.risk !== input.risk ||
      command.action.request.contentHash !== input.requestDigest ||
      !sameValues(command.action.verificationSuiteIds, input.verificationSuiteIds) ||
      (input.requestedPath !== null && !input.expectedPaths.includes(input.requestedPath))
    ) return { approved: false, reasonCode: "managed_run_binding_mismatch" };
    if (
      evaluatedAtMs < Date.parse(command.issuedAt) ||
      evaluatedAtMs > Date.parse(command.expiresAt)
    ) return { approved: false, reasonCode: "remote_command_not_current" };

    let snapshotEnvelope;
    try {
      snapshotEnvelope = await this.options.store.getCurrentSnapshot();
    } catch (error) {
      throw new PolicyRuntimeError("policy_store_failed", "현재 policy snapshot을 읽지 못했습니다.", { cause: error });
    }
    if (
      snapshotEnvelope === null ||
      snapshotEnvelope.snapshot.snapshotId !== input.authorization.policySnapshotId
    ) return { approved: false, reasonCode: "policy_snapshot_changed" };
    const snapshot = snapshotEnvelope.snapshot;
    assertPolicySnapshot(snapshot);
    if (
      evaluatedAtMs < Date.parse(snapshot.issuedAt) ||
      evaluatedAtMs > Date.parse(snapshot.expiresAt)
    ) return { approved: false, reasonCode: "policy_snapshot_not_current" };
    await verifyPolicyEnvelope({
      trustStore: this.options.trustStore,
      purpose: "snapshot",
      original: snapshot,
      signature: snapshotEnvelope.signature,
      target: command.target,
      signatureBytes: policySignatureBytes(snapshotEnvelope),
    });

    for (const approvalId of input.authorization.approvalIds) {
      let state;
      try {
        state = await this.options.store.getApproval(approvalId);
      } catch (error) {
        throw new PolicyRuntimeError("policy_store_failed", "managed run approval 원본을 읽지 못했습니다.", { cause: error });
      }
      if (state === null) continue;
      try {
        assertPolicyApproval({
          approval: state.approval.approval,
          snapshot,
          command,
          commandSignerKeyId: input.authorization.commandSignerKeyId,
        });
        await verifyPolicyEnvelope({
          trustStore: this.options.trustStore,
          purpose: "approval",
          original: state.approval.approval,
          signature: state.approval.signature,
          target: command.target,
          signatureBytes: policySignatureBytes(state.approval),
        });
        if (state.revocation !== null) {
          assertPolicyApprovalRevocation({
            revocation: state.revocation.revocation,
            approval: state.approval.approval,
          });
          await verifyPolicyEnvelope({
            trustStore: this.options.trustStore,
            purpose: "revocation",
            original: state.revocation.revocation,
            signature: state.revocation.signature,
            target: command.target,
            signatureBytes: policySignatureBytes(state.revocation),
          });
        }
      } catch (error) {
        throw new PolicyRuntimeError(
          "policy_evaluation_failed",
          "managed run approval 서명 원본을 검증하지 못했습니다.",
          { cause: error },
        );
      }
      const approval = state.approval.approval;
      if (
        approval.capability !== "filesystem.write" ||
        evaluatedAtMs < Date.parse(approval.grantedAt) ||
        evaluatedAtMs > Date.parse(approval.expiresAt) ||
        (state.revocation !== null &&
          evaluatedAtMs >= Date.parse(state.revocation.revocation.revokedAt)) ||
        !input.expectedPaths.every((path) => approval.repositoryPaths.includes(path)) ||
        (input.requestedPath !== null &&
          !approval.repositoryPaths.includes(input.requestedPath))
      ) continue;
      return {
        approved: true,
        approvalId: approval.approvalId,
        policySnapshotId: snapshot.snapshotId,
      };
    }
    return { approved: false, reasonCode: "active_approval_missing" };
  }
}

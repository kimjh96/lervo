import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertPolicySnapshot,
  policySignatureBytes,
} from "@lervo/policy-contract";
import { calculateRemoteCommandHash } from "@lervo/remote-command-contract";
import {
  type CapabilityDecision,
  type ManagedRunApprovalAuthorization,
  type PolicyApproval,
  type RemoteCommand,
} from "@lervo/schemas";

import { PolicyRuntimeError } from "./errors.js";
import {
  type LocalCommandCapabilityPolicy,
  type PolicyStateStore,
  type PolicyTrustStore,
} from "./types.js";
import { verifyPolicyEnvelope } from "./bundle-verifier.js";

const decisionWeight: Record<CapabilityDecision, number> = {
  allow: 0,
  require_approval: 1,
  deny: 2,
};

function stricter(left: CapabilityDecision, right: CapabilityDecision): CapabilityDecision {
  return decisionWeight[left] >= decisionWeight[right] ? left : right;
}

export interface PolicyBackedRemoteCommandPolicyOptions {
  store: PolicyStateStore;
  trustStore: PolicyTrustStore;
  localPolicy: LocalCommandCapabilityPolicy;
}

export class PolicyBackedRemoteCommandPolicy {
  constructor(private readonly options: PolicyBackedRemoteCommandPolicyOptions) {}

  async authorize(input: {
    command: RemoteCommand;
    signerKeyId: string;
    evaluatedAt: string;
  }): Promise<
    | {
        status: "approved";
        policySnapshotId: string | null;
        approvalIds: string[];
        authorization?: ManagedRunApprovalAuthorization;
      }
    | { status: "denied"; reasonCode: string }
    | { status: "approval_required"; reasonCode: string; capability: PolicyApproval["capability"] }
  > {
    const evaluatedAtMs = Date.parse(input.evaluatedAt);
    if (!Number.isFinite(evaluatedAtMs)) {
      throw new PolicyRuntimeError("policy_evaluation_failed", "policy 평가 시각이 유효하지 않습니다.");
    }
    let localDecisions;
    let envelope;
    try {
      [localDecisions, envelope] = await Promise.all([
        this.options.localPolicy.resolve(structuredClone(input.command)),
        this.options.store.getCurrentSnapshot(),
      ]);
    } catch (error) {
      throw new PolicyRuntimeError("policy_store_failed", "policy 평가 원본을 읽지 못했습니다.", { cause: error });
    }
    if (!Array.isArray(localDecisions) || localDecisions.length < 1 || localDecisions.length > 7) {
      throw new PolicyRuntimeError("policy_evaluation_failed", "local capability policy 결과가 유효하지 않습니다.");
    }
    const capabilitySet = new Set<string>();
    for (const entry of localDecisions) {
      if (
        capabilitySet.has(entry.capability) ||
        !["allow", "deny", "require_approval"].includes(entry.decision)
      ) throw new PolicyRuntimeError("policy_evaluation_failed", "local capability policy 결과가 중복되거나 유효하지 않습니다.");
      capabilitySet.add(entry.capability);
    }

    const snapshot = envelope?.snapshot ?? null;
    if (snapshot !== null) {
      assertPolicySnapshot(snapshot);
      if (evaluatedAtMs < Date.parse(snapshot.issuedAt) || evaluatedAtMs > Date.parse(snapshot.expiresAt)) {
        return { status: "denied", reasonCode: "hub_policy_not_current" };
      }
      await verifyPolicyEnvelope({
        trustStore: this.options.trustStore,
        purpose: "snapshot",
        original: snapshot,
        signature: envelope!.signature,
        target: input.command.target,
        signatureBytes: policySignatureBytes(envelope!),
      });
    }

    const approvalIds: string[] = [];
    for (const entry of localDecisions) {
      const hubRule = snapshot?.rules.find((rule) =>
        rule.roleId === input.command.action.roleId &&
        rule.risk === input.command.action.risk &&
        rule.capability === entry.capability
      );
      const decision = hubRule === undefined
        ? entry.decision
        : stricter(entry.decision, hubRule.decision);
      if (decision === "deny") {
        return { status: "denied", reasonCode: hubRule?.decision === "deny" ? "hub_policy_denied" : "local_policy_denied" };
      }
      if (decision !== "require_approval") continue;
      if (snapshot === null) {
        return { status: "approval_required", reasonCode: "approval_snapshot_missing", capability: entry.capability };
      }
      let states;
      try {
        states = await this.options.store.findApprovals({
          snapshotId: snapshot.snapshotId,
          commandId: input.command.commandId,
          commandSignerKeyId: input.signerKeyId,
          capability: entry.capability,
        });
      } catch (error) {
        throw new PolicyRuntimeError("policy_store_failed", "policy approval을 읽지 못했습니다.", { cause: error });
      }
      let accepted: string | null = null;
      for (const state of states) {
        try {
          assertPolicyApproval({
            approval: state.approval.approval,
            snapshot,
            command: input.command,
            commandSignerKeyId: input.signerKeyId,
          });
          if (state.revocation !== null) {
            assertPolicyApprovalRevocation({
              revocation: state.revocation.revocation,
              approval: state.approval.approval,
            });
          }
          await verifyPolicyEnvelope({
            trustStore: this.options.trustStore,
            purpose: "approval",
            original: state.approval.approval,
            signature: state.approval.signature,
            target: input.command.target,
            signatureBytes: policySignatureBytes(state.approval),
          });
          if (state.revocation !== null) {
            await verifyPolicyEnvelope({
              trustStore: this.options.trustStore,
              purpose: "revocation",
              original: state.revocation.revocation,
              signature: state.revocation.signature,
              target: input.command.target,
              signatureBytes: policySignatureBytes(state.revocation),
            });
          }
        } catch (error) {
          throw new PolicyRuntimeError(
            "policy_evaluation_failed",
            "저장된 policy approval 또는 revocation을 검증하지 못했습니다.",
            { cause: error },
          );
        }
        const approval = state.approval.approval;
        if (
          approval.commandHash !== calculateRemoteCommandHash(input.command) ||
          evaluatedAtMs < Date.parse(approval.grantedAt) ||
          evaluatedAtMs > Date.parse(approval.expiresAt) ||
          (state.revocation !== null && evaluatedAtMs >= Date.parse(state.revocation.revocation.revokedAt))
        ) continue;
        accepted = approval.approvalId;
        break;
      }
      if (accepted === null) {
        return { status: "approval_required", reasonCode: "active_approval_missing", capability: entry.capability };
      }
      approvalIds.push(accepted);
    }
    return {
      status: "approved",
      policySnapshotId: snapshot?.snapshotId ?? null,
      approvalIds: approvalIds.sort(),
      ...(snapshot !== null && approvalIds.length > 0
        ? {
            authorization: {
              schemaVersion: 1 as const,
              source: "remote_command" as const,
              command: structuredClone(input.command),
              commandSignerKeyId: input.signerKeyId,
              policySnapshotId: snapshot.snapshotId,
              approvalIds: approvalIds.sort(),
            },
          }
        : {}),
    };
  }
}

import type { PolicyRule, SignedPolicyApproval } from "@lervo/schemas";

import type {
  HubCommandApprovalOption,
  HubCommandApprovalState,
  HubCommandControlSource,
  HubCommandReview,
} from "./types.js";
import { HubControlError } from "./types.js";

const DELIVERY_ID = /^rcd_[a-f0-9]{64}$/u;
const PROJECT_ID = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

function validTime(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new HubControlError("source_inconsistent", `${label} 시각이 유효하지 않습니다.`);
  }
  return result;
}

function covers(approval: SignedPolicyApproval, rule: PolicyRule, at: number): boolean {
  return approval.approval.capability === rule.capability &&
    validTime(approval.approval.grantedAt, "approval grantedAt") <= at &&
    at <= validTime(approval.approval.expiresAt, "approval expiresAt") &&
    (rule.repositoryPaths ?? []).every((path) => approval.approval.repositoryPaths.includes(path));
}

function approvalState(input: {
  denied: boolean;
  required: readonly PolicyRule[];
  options: readonly HubCommandApprovalOption[];
  available: boolean;
}): HubCommandApprovalState {
  if (!input.available) return "unavailable";
  if (input.denied) return "denied";
  if (input.required.length === 0) return "not_required";
  const approved = input.options.filter((option) => option.approvalId !== null).length;
  if (approved === 0) return "approval_required";
  return approved === input.required.length ? "approved" : "partially_approved";
}

export class HubCommandControlReader {
  constructor(private readonly source: HubCommandControlSource) {}

  async inspect(input: {
    destinationId: string;
    projectId: string;
    deliveryId: string;
    inspectedAt: string;
  }): Promise<HubCommandReview> {
    if (!DESTINATION_ID.test(input.destinationId) || !PROJECT_ID.test(input.projectId) ||
      !DELIVERY_ID.test(input.deliveryId)) {
      throw new HubControlError("invalid_control_request", "Command review 좌표가 유효하지 않습니다.");
    }
    const inspectedAtMs = validTime(input.inspectedAt, "inspectedAt");
    let delivery;
    try {
      delivery = await this.source.getRemoteCommandDelivery(input.deliveryId);
    } catch (error) {
      throw new HubControlError("source_inconsistent", "Command delivery를 읽지 못했습니다.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (delivery === null || delivery.destinationId !== input.destinationId ||
      delivery.target.projectId !== input.projectId) {
      throw new HubControlError("command_not_found", "조회할 command가 없습니다.");
    }
    let binding;
    try {
      binding = await this.source.getPolicyCommand({
        destinationId: input.destinationId,
        target: delivery.target,
        commandId: delivery.commandId,
      });
    } catch (error) {
      throw new HubControlError("source_inconsistent", "Command 원본을 읽지 못했습니다.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (binding === null || binding.command.commandId !== delivery.commandId) {
      throw new HubControlError("source_inconsistent", "Delivery와 command 원본이 연결되지 않습니다.");
    }
    const command = binding.command;
    const [snapshot, bundle] = await Promise.all([
      this.source.getCurrentPolicySnapshot({ destinationId: input.destinationId, target: delivery.target }),
      this.source.pullPolicyBundle({
        destinationId: input.destinationId,
        target: delivery.target,
        currentSnapshotId: null,
      }),
    ]);
    if ((snapshot === null) !== (bundle === null) ||
      (snapshot !== null && bundle !== null &&
        snapshot.snapshot.snapshotId !== bundle.snapshot.snapshot.snapshotId)) {
      throw new HubControlError("source_inconsistent", "Policy head와 review bundle이 다릅니다.");
    }
    const matchingRules = snapshot?.snapshot.rules.filter((rule) =>
      rule.roleId === command.action.roleId && rule.risk === command.action.risk
    ) ?? [];
    const required = matchingRules.filter((rule) => rule.decision === "require_approval");
    const denied = matchingRules.some((rule) => rule.decision === "deny");
    const commandApprovals = bundle?.approvals.filter((approval) =>
      approval.approval.commandId === command.commandId
    ) ?? [];
    const revokedIds = new Set((bundle?.revocations ?? []).map((item) => item.revocation.approvalId));
    const activeApprovals = commandApprovals.filter((approval) => !revokedIds.has(approval.approval.approvalId));
    const options = required.map((rule): HubCommandApprovalOption => ({
      capability: rule.capability,
      repositoryPaths: [...(rule.repositoryPaths ?? [])].sort(),
      approvalId: activeApprovals.find((approval) => covers(approval, rule, inspectedAtMs))
        ?.approval.approvalId ?? null,
    }));
    const maximumExpiresAt = snapshot === null
      ? null
      : new Date(Math.min(
          validTime(snapshot.snapshot.expiresAt, "snapshot expiresAt"),
          validTime(command.expiresAt, "command expiresAt"),
        )).toISOString();
    return {
      schemaVersion: 1,
      destinationId: input.destinationId,
      projectId: input.projectId,
      projectIdentityHash: delivery.target.projectIdentityHash,
      delivery: {
        deliveryId: delivery.deliveryId,
        commandId: delivery.commandId,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        queuedAt: delivery.queuedAt,
        expiresAt: delivery.expiresAt,
        terminalAt: delivery.terminalAt,
      },
      command: {
        roleId: command.action.roleId,
        provider: command.action.provider,
        risk: command.action.risk,
        verificationSuiteIds: [...command.action.verificationSuiteIds].sort(),
        issuedAt: command.issuedAt,
        expiresAt: command.expiresAt,
      },
      approval: {
        state: approvalState({ denied, required, options, available: snapshot !== null }),
        snapshotId: snapshot?.snapshot.snapshotId ?? null,
        maximumExpiresAt,
        hadRevokedApproval: commandApprovals.some((approval) =>
          revokedIds.has(approval.approval.approvalId)),
        options,
      },
      inspectedAt: input.inspectedAt,
    };
  }
}

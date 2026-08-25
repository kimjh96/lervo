import type { HubPolicySourceStore } from "@lervo/hub-policy";
import type { HubRemoteCommandQueueInspectionStore } from "@lervo/hub-sync";

export interface HubCommandControlSource
  extends
    HubRemoteCommandQueueInspectionStore,
    Pick<
      HubPolicySourceStore,
      "getCurrentPolicySnapshot" | "getPolicyCommand" | "pullPolicyBundle"
    > {}

export interface HubCommandApprovalOption {
  capability: string;
  repositoryPaths: string[];
  approvalId: string | null;
}

export type HubCommandApprovalState =
  | "unavailable"
  | "denied"
  | "not_required"
  | "approval_required"
  | "partially_approved"
  | "approved";

export interface HubCommandReview {
  schemaVersion: 1;
  destinationId: string;
  projectId: string;
  projectIdentityHash: string;
  delivery: {
    deliveryId: string;
    commandId: string;
    status: "pending" | "leased" | "completed" | "rejected" | "expired";
    attemptCount: number;
    queuedAt: string;
    expiresAt: string;
    terminalAt: string | null;
  };
  command: {
    roleId: string;
    provider: string;
    risk: "low" | "medium" | "high";
    verificationSuiteIds: string[];
    issuedAt: string;
    expiresAt: string;
  };
  approval: {
    state: HubCommandApprovalState;
    snapshotId: string | null;
    maximumExpiresAt: string | null;
    hadRevokedApproval: boolean;
    options: HubCommandApprovalOption[];
  };
  inspectedAt: string;
}

export class HubControlError extends Error {
  constructor(
    readonly code: "command_not_found" | "invalid_control_request" | "source_inconsistent",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubControlError";
  }
}

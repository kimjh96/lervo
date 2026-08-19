import type {
  PolicyApproval,
  PolicyApprovalRevocation,
  PolicyRule,
  PolicySnapshot,
  RemoteCommand,
  RemoteCommandTarget,
  SignedPolicyApproval,
  SignedPolicyApprovalRevocation,
  SignedPolicySnapshot,
} from "@lervo/schemas";

export interface HubPolicyBundle {
  snapshot: SignedPolicySnapshot;
  approvals: SignedPolicyApproval[];
  revocations: SignedPolicyApprovalRevocation[];
}

export interface HubPolicySigner {
  readonly keyId: string;
  signSnapshot(snapshot: PolicySnapshot): SignedPolicySnapshot;
  signApproval(approval: PolicyApproval): SignedPolicyApproval;
  signRevocation(revocation: PolicyApprovalRevocation): SignedPolicyApprovalRevocation;
}

export interface HubPolicyCommandBinding {
  command: RemoteCommand;
  commandSignerKeyId: string;
}

export interface HubPolicyPublishResult {
  status: "published" | "duplicate";
  policySnapshotId: string;
  originalId: string;
  publishedAt: string;
}

export interface HubPolicySourceStore {
  getCurrentPolicySnapshot(input: {
    destinationId: string;
    target: RemoteCommandTarget;
  }): Promise<SignedPolicySnapshot | null>;

  getPolicyCommand(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    commandId: string;
  }): Promise<HubPolicyCommandBinding | null>;

  getPolicyApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    approvalId: string;
  }): Promise<SignedPolicyApproval | null>;

  publishPolicySnapshot(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicySnapshot;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult>;

  publishPolicyApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApproval;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult>;

  publishPolicyRevocation(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApprovalRevocation;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult>;

  pullPolicyBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
  }): Promise<HubPolicyBundle | null>;
}

export interface AuthorPolicySnapshotInput {
  destinationId: string;
  target: RemoteCommandTarget;
  rules: PolicyRule[];
  issuedAt: string;
  expiresAt: string;
  publishedAt: string;
}

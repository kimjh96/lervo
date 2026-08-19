import {
  type CapabilityDecision,
  type PolicyApproval,
  type RemoteCommand,
  type RemoteCommandTarget,
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { type PolicySignaturePurpose } from "@lervo/policy-contract";

export interface TrustedPolicySigner {
  keyId: string;
  projects: RemoteCommandTarget[];
  purposes: PolicySignaturePurpose[];
  verify(input: { message: Uint8Array; signature: Uint8Array }): Promise<boolean>;
}

export interface PolicyTrustStore {
  find(keyId: string): Promise<TrustedPolicySigner | null>;
}

export interface PolicyBundle {
  snapshot: SignedPolicySnapshot;
  approvals: SignedPolicyApproval[];
  revocations: SignedPolicyApprovalRevocation[];
}

export interface PolicyApprovalState {
  approval: SignedPolicyApproval;
  revocation: SignedPolicyApprovalRevocation | null;
}

export interface VerifiedPolicyBundle extends PolicyBundle {
  readonly verifiedAt: string;
}

export interface PolicyStateStore {
  getCurrentSnapshot(): Promise<SignedPolicySnapshot | null>;
  getApproval(approvalId: string): Promise<PolicyApprovalState | null>;
  findApprovals(input: {
    snapshotId: string;
    commandId: string;
    commandSignerKeyId: string;
    capability: PolicyApproval["capability"];
  }): Promise<PolicyApprovalState[]>;
  applyVerifiedBundle(bundle: VerifiedPolicyBundle): Promise<{
    status: "applied" | "duplicate";
    snapshotId: string;
    approvalCount: number;
    revocationCount: number;
  }>;
}

export interface LocalCommandCapabilityPolicy {
  resolve(command: RemoteCommand): Promise<Array<{
    capability: PolicyApproval["capability"];
    decision: CapabilityDecision;
  }>>;
}

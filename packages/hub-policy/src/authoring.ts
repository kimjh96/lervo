import { createHash } from "node:crypto";

import {
  createPolicyApproval,
  createPolicyApprovalRevocation,
  createPolicySnapshot,
} from "@lervo/policy-contract";
import type { PolicyApproval, PolicyApprovalRevocation } from "@lervo/schemas";

import { HubPolicyError } from "./errors.js";
import type {
  AuthorPolicySnapshotInput,
  HubPolicyPublishResult,
  HubPolicySigner,
  HubPolicySourceStore,
} from "./types.js";

const APPROVAL_ID_PATTERN = /^apr_[a-f0-9]{64}$/u;
const COMMAND_ID_PATTERN = /^rcm_[a-f0-9]{64}$/u;

export function hashPolicyApproverSubject(input: {
  principalId: string;
  projectIdentityHash: string;
}): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(input.principalId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.projectIdentityHash)
  ) {
    throw new HubPolicyError(
      "invalid_policy_request",
      "Policy approver principal ID가 유효하지 않습니다.",
    );
  }
  return `sha256:${createHash("sha256")
    .update(`${input.projectIdentityHash}\0${input.principalId}`, "utf8")
    .digest("hex")}`;
}

function wrapContractError(label: string, error: unknown): HubPolicyError {
  return new HubPolicyError(
    "invalid_policy_request",
    `${label} 계약이 유효하지 않습니다.`,
    { cause: error instanceof Error ? error : undefined },
  );
}

function assertPublishedBeforeExpiry(publishedAt: string, expiresAt: string): void {
  if (
    !Number.isFinite(Date.parse(publishedAt)) ||
    Date.parse(publishedAt) >= Date.parse(expiresAt)
  ) {
    throw new HubPolicyError(
      "invalid_policy_request",
      "만료된 policy 원본은 새로 발행할 수 없습니다.",
    );
  }
}

export async function authorPolicySnapshot(input: {
  store: HubPolicySourceStore;
  signer: HubPolicySigner;
  request: AuthorPolicySnapshotInput;
}): Promise<HubPolicyPublishResult> {
  assertPublishedBeforeExpiry(input.request.publishedAt, input.request.expiresAt);
  const current = await input.store.getCurrentPolicySnapshot({
    destinationId: input.request.destinationId,
    target: structuredClone(input.request.target),
  });
  let snapshot;
  try {
    snapshot = createPolicySnapshot({
      target: structuredClone(input.request.target),
      sequence: (current?.snapshot.sequence ?? 0) + 1,
      previousSnapshotId: current?.snapshot.snapshotId ?? null,
      issuedAt: input.request.issuedAt,
      expiresAt: input.request.expiresAt,
      rules: structuredClone(input.request.rules),
    });
  } catch (error) {
    throw wrapContractError("Policy snapshot", error);
  }
  return input.store.publishPolicySnapshot({
    destinationId: input.request.destinationId,
    target: structuredClone(input.request.target),
    envelope: input.signer.signSnapshot(snapshot),
    publishedAt: input.request.publishedAt,
  });
}

export async function authorPolicyApproval(input: {
  store: HubPolicySourceStore;
  signer: HubPolicySigner;
  request: {
    destinationId: string;
    target: import("@lervo/schemas").RemoteCommandTarget;
    commandId: string;
    capability: PolicyApproval["capability"];
    repositoryPaths: string[];
    approverSubjectHash: string;
    grantedAt: string;
    expiresAt: string;
    publishedAt: string;
  };
}): Promise<HubPolicyPublishResult> {
  assertPublishedBeforeExpiry(input.request.publishedAt, input.request.expiresAt);
  if (!COMMAND_ID_PATTERN.test(input.request.commandId)) {
    throw new HubPolicyError("invalid_policy_request", "Policy approval command ID가 유효하지 않습니다.");
  }
  const [snapshot, binding] = await Promise.all([
    input.store.getCurrentPolicySnapshot({
      destinationId: input.request.destinationId,
      target: structuredClone(input.request.target),
    }),
    input.store.getPolicyCommand({
      destinationId: input.request.destinationId,
      target: structuredClone(input.request.target),
      commandId: input.request.commandId,
    }),
  ]);
  if (snapshot === null) {
    throw new HubPolicyError("policy_snapshot_conflict", "승인에 사용할 현재 policy snapshot이 없습니다.");
  }
  if (binding === null) {
    throw new HubPolicyError("policy_command_not_found", "승인할 remote command가 Hub queue에 없습니다.");
  }
  let approval;
  try {
    approval = createPolicyApproval({
      snapshot: snapshot.snapshot,
      command: binding.command,
      commandSignerKeyId: binding.commandSignerKeyId,
      capability: input.request.capability,
      repositoryPaths: [...input.request.repositoryPaths],
      approverSubjectHash: input.request.approverSubjectHash,
      grantedAt: input.request.grantedAt,
      expiresAt: input.request.expiresAt,
    });
  } catch (error) {
    throw wrapContractError("Policy approval", error);
  }
  return input.store.publishPolicyApproval({
    destinationId: input.request.destinationId,
    target: structuredClone(input.request.target),
    envelope: input.signer.signApproval(approval),
    publishedAt: input.request.publishedAt,
  });
}

export async function authorPolicyRevocation(input: {
  store: HubPolicySourceStore;
  signer: HubPolicySigner;
  request: {
    destinationId: string;
    target: import("@lervo/schemas").RemoteCommandTarget;
    approvalId: string;
    reasonCode: PolicyApprovalRevocation["reasonCode"];
    revokedAt: string;
    publishedAt: string;
  };
}): Promise<HubPolicyPublishResult> {
  if (!APPROVAL_ID_PATTERN.test(input.request.approvalId)) {
    throw new HubPolicyError("invalid_policy_request", "Policy revocation approval ID가 유효하지 않습니다.");
  }
  const envelope = await input.store.getPolicyApproval({
    destinationId: input.request.destinationId,
    target: structuredClone(input.request.target),
    approvalId: input.request.approvalId,
  });
  if (envelope === null) {
    throw new HubPolicyError("policy_approval_not_found", "철회할 policy approval이 없습니다.");
  }
  let revocation;
  try {
    revocation = createPolicyApprovalRevocation({
      approval: envelope.approval,
      revokedAt: input.request.revokedAt,
      reasonCode: input.request.reasonCode,
    });
  } catch (error) {
    throw wrapContractError("Policy revocation", error);
  }
  return input.store.publishPolicyRevocation({
    destinationId: input.request.destinationId,
    target: structuredClone(input.request.target),
    envelope: input.signer.signRevocation(revocation),
    publishedAt: input.request.publishedAt,
  });
}

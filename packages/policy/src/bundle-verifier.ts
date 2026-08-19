import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertSignedPolicyApproval,
  assertSignedPolicyApprovalRevocation,
  assertSignedPolicySnapshot,
  policySignatureBytes,
  policySigningBytes,
  type PolicySignaturePurpose,
} from "@lervo/policy-contract";
import {
  type PolicyApproval,
  type RemoteCommandTarget,
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { PolicyRuntimeError } from "./errors.js";
import {
  type PolicyBundle,
  type PolicyStateStore,
  type PolicyTrustStore,
  type VerifiedPolicyBundle,
} from "./types.js";

function sameTarget(left: RemoteCommandTarget, right: RemoteCommandTarget): boolean {
  return left.projectId === right.projectId &&
    left.projectIdentityHash === right.projectIdentityHash;
}

function validTarget(target: unknown): target is RemoteCommandTarget {
  return typeof target === "object" && target !== null &&
    "projectId" in target && typeof target.projectId === "string" &&
    /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) &&
    "projectIdentityHash" in target && typeof target.projectIdentityHash === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(target.projectIdentityHash);
}

export async function verifyPolicyEnvelope(input: {
  trustStore: PolicyTrustStore;
  purpose: PolicySignaturePurpose;
  original: SignedPolicySnapshot["snapshot"] | PolicyApproval |
    SignedPolicyApprovalRevocation["revocation"];
  signature: SignedPolicySnapshot["signature"];
  target: RemoteCommandTarget;
  signatureBytes: Uint8Array;
}): Promise<void> {
  let signer;
  try {
    signer = await input.trustStore.find(input.signature.keyId);
  } catch (error) {
    throw new PolicyRuntimeError("policy_store_failed", "policy trust store 조회에 실패했습니다.", { cause: error });
  }
  if (signer === null) {
    throw new PolicyRuntimeError("unknown_policy_signer", "신뢰되지 않은 policy signer입니다.");
  }
  if (
    signer.keyId !== input.signature.keyId || typeof signer.verify !== "function" ||
    !Array.isArray(signer.projects) || signer.projects.length < 1 || signer.projects.length > 256 ||
    !signer.projects.every(validTarget) || !Array.isArray(signer.purposes) ||
    signer.purposes.length < 1 || signer.purposes.length > 3 ||
    !signer.purposes.every((purpose) =>
      purpose === "snapshot" || purpose === "approval" || purpose === "revocation"
    )
  ) throw new PolicyRuntimeError("policy_store_failed", "policy trust store 결과가 유효하지 않습니다.");
  if (!signer.purposes.includes(input.purpose)) {
    throw new PolicyRuntimeError("policy_signer_purpose_denied", "policy signer purpose가 허용되지 않았습니다.");
  }
  if (!signer.projects.some((target) => sameTarget(target, input.target))) {
    throw new PolicyRuntimeError("policy_signer_scope_denied", "policy signer project scope가 다릅니다.");
  }
  let valid = false;
  try {
    valid = await signer.verify({
      message: policySigningBytes({
        purpose: input.purpose,
        original: input.original,
        keyId: input.signature.keyId,
      }),
      signature: input.signatureBytes,
    });
  } catch {
    valid = false;
  }
  if (!valid) throw new PolicyRuntimeError("invalid_policy_signature", "policy signature 검증에 실패했습니다.");
}

function assertBundleShape(bundle: PolicyBundle): void {
  if (
    typeof bundle !== "object" || bundle === null ||
    !Array.isArray(bundle.approvals) || bundle.approvals.length > 64 ||
    !Array.isArray(bundle.revocations) || bundle.revocations.length > 64
  ) throw new PolicyRuntimeError("invalid_policy_bundle", "policy bundle 구조나 크기가 유효하지 않습니다.");
}

export async function verifyPolicyBundle(input: {
  bundle: PolicyBundle;
  target: RemoteCommandTarget;
  trustStore: PolicyTrustStore;
  store: PolicyStateStore;
  verifiedAt: string;
  clockSkewMs?: number;
}): Promise<VerifiedPolicyBundle> {
  assertBundleShape(input.bundle);
  const verifiedAtMs = Date.parse(input.verifiedAt);
  const clockSkewMs = input.clockSkewMs ?? 30_000;
  if (!Number.isFinite(verifiedAtMs) || !Number.isSafeInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 60_000) {
    throw new PolicyRuntimeError("invalid_runtime_configuration", "policy 검증 시각 설정이 유효하지 않습니다.");
  }
  try {
    assertSignedPolicySnapshot(input.bundle.snapshot);
  } catch (error) {
    throw new PolicyRuntimeError("invalid_policy_bundle", "policy snapshot 계약이 유효하지 않습니다.", { cause: error });
  }
  const snapshot = input.bundle.snapshot.snapshot;
  if (
    !sameTarget(snapshot.target, input.target) ||
    verifiedAtMs + clockSkewMs < Date.parse(snapshot.issuedAt) ||
    verifiedAtMs - clockSkewMs > Date.parse(snapshot.expiresAt)
  ) throw new PolicyRuntimeError("invalid_policy_bundle", "policy snapshot 대상이나 유효 기간이 맞지 않습니다.");
  await verifyPolicyEnvelope({
    trustStore: input.trustStore,
    purpose: "snapshot",
    original: snapshot,
    signature: input.bundle.snapshot.signature,
    target: input.target,
    signatureBytes: policySignatureBytes(input.bundle.snapshot),
  });

  const approvals = new Map<string, SignedPolicyApproval>();
  for (const envelope of input.bundle.approvals) {
    try {
      assertSignedPolicyApproval(envelope);
      assertPolicyApproval({ approval: envelope.approval, snapshot });
    } catch (error) {
      throw new PolicyRuntimeError("invalid_policy_bundle", "policy approval이 snapshot과 맞지 않습니다.", { cause: error });
    }
    if (approvals.has(envelope.approval.approvalId)) {
      throw new PolicyRuntimeError("invalid_policy_bundle", "policy approval ID가 중복되었습니다.");
    }
    approvals.set(envelope.approval.approvalId, envelope);
    await verifyPolicyEnvelope({
      trustStore: input.trustStore,
      purpose: "approval",
      original: envelope.approval,
      signature: envelope.signature,
      target: input.target,
      signatureBytes: policySignatureBytes(envelope),
    });
  }

  const revocationIds = new Set<string>();
  const revokedApprovals = new Set<string>();
  for (const envelope of input.bundle.revocations) {
    try {
      assertSignedPolicyApprovalRevocation(envelope);
    } catch (error) {
      throw new PolicyRuntimeError("invalid_policy_bundle", "policy revocation 계약이 유효하지 않습니다.", { cause: error });
    }
    if (
      revocationIds.has(envelope.revocation.revocationId) ||
      revokedApprovals.has(envelope.revocation.approvalId)
    ) throw new PolicyRuntimeError("invalid_policy_bundle", "policy revocation 좌표가 중복되었습니다.");
    revocationIds.add(envelope.revocation.revocationId);
    revokedApprovals.add(envelope.revocation.approvalId);
    const bundled = approvals.get(envelope.revocation.approvalId);
    const stored = bundled === undefined
      ? await input.store.getApproval(envelope.revocation.approvalId).catch((error: unknown) => {
          throw new PolicyRuntimeError("policy_store_failed", "policy approval 원본을 읽지 못했습니다.", { cause: error });
        })
      : null;
    const approval = bundled?.approval ?? stored?.approval.approval;
    if (approval === undefined) {
      throw new PolicyRuntimeError("invalid_policy_bundle", "policy revocation의 approval 원본이 없습니다.");
    }
    try {
      assertPolicyApprovalRevocation({ revocation: envelope.revocation, approval });
    } catch (error) {
      throw new PolicyRuntimeError("invalid_policy_bundle", "policy revocation이 approval과 맞지 않습니다.", { cause: error });
    }
    await verifyPolicyEnvelope({
      trustStore: input.trustStore,
      purpose: "revocation",
      original: envelope.revocation,
      signature: envelope.signature,
      target: input.target,
      signatureBytes: policySignatureBytes(envelope),
    });
  }
  return structuredClone({ ...input.bundle, verifiedAt: input.verifiedAt });
}

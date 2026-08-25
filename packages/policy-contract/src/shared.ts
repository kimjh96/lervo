import { createHash } from "node:crypto";

import {
  type PolicyApproval,
  type PolicyApprovalRevocation,
  type PolicySnapshot,
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { PolicyContractError } from "./errors.js";

export type SignedPolicyOriginal = PolicySnapshot | PolicyApproval | PolicyApprovalRevocation;
export type SignedPolicyEnvelope =
  SignedPolicySnapshot | SignedPolicyApproval | SignedPolicyApprovalRevocation;

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function sameTarget(
  left: PolicySnapshot["target"],
  right: PolicySnapshot["target"],
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

export function assertKeyId(keyId: string): void {
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(keyId)) {
    throw new PolicyContractError(
      "invalid_policy_signature",
      "The policy signature key ID is invalid.",
    );
  }
}

export function assertSignatureEncoding(envelope: SignedPolicyEnvelope): void {
  const bytes = Buffer.from(envelope.signature.value, "base64url");
  if (bytes.byteLength !== 64 || bytes.toString("base64url") !== envelope.signature.value) {
    throw new PolicyContractError(
      "invalid_policy_signature",
      "The policy signature encoding is invalid.",
    );
  }
}

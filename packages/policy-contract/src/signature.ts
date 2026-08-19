import { canonicalJson } from "@lervo/event-contract";
import {
  type PolicyApproval,
  type PolicyApprovalRevocation,
  type PolicySnapshot,
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
  validateSchema,
} from "@lervo/schemas";

import { PolicyContractError } from "./errors.js";
import {
  assertKeyId,
  assertSignatureEncoding,
  clone,
  type SignedPolicyEnvelope,
  type SignedPolicyOriginal,
} from "./shared.js";
import { assertPolicySnapshot } from "./snapshot.js";

export type PolicySignaturePurpose = "snapshot" | "approval" | "revocation";

function signatureOriginal(purpose: PolicySignaturePurpose, original: SignedPolicyOriginal): object {
  if (purpose === "snapshot") return { snapshot: original };
  if (purpose === "approval") return { approval: original };
  return { revocation: original };
}

export function policySigningBytes(input: {
  purpose: PolicySignaturePurpose;
  original: SignedPolicyOriginal;
  keyId: string;
}): Uint8Array {
  assertKeyId(input.keyId);
  return Buffer.from(canonicalJson({
    domain: `lervo.policy.${input.purpose}.v1`,
    algorithm: "ed25519",
    keyId: input.keyId,
    ...signatureOriginal(input.purpose, clone(input.original)),
  }), "utf8");
}

function createSignature(keyId: string, signature: Uint8Array) {
  assertKeyId(keyId);
  if (signature.byteLength !== 64) {
    throw new PolicyContractError("invalid_policy_signature", "Ed25519 signature은 64 bytes여야 합니다.");
  }
  return {
    algorithm: "ed25519" as const,
    keyId,
    value: Buffer.from(signature).toString("base64url"),
  };
}

export function createSignedPolicySnapshot(input: {
  snapshot: PolicySnapshot;
  keyId: string;
  signature: Uint8Array;
}): SignedPolicySnapshot {
  assertPolicySnapshot(input.snapshot);
  const envelope: SignedPolicySnapshot = {
    schemaVersion: 1,
    snapshot: clone(input.snapshot),
    signature: createSignature(input.keyId, input.signature),
  };
  assertSignedPolicySnapshot(envelope);
  return clone(envelope);
}

export function assertSignedPolicySnapshot(envelope: SignedPolicySnapshot): void {
  if (!validateSchema("signedPolicySnapshot", envelope).valid) {
    throw new PolicyContractError("invalid_policy_signature", "signed policy snapshot이 유효하지 않습니다.");
  }
  assertPolicySnapshot(envelope.snapshot);
  assertSignatureEncoding(envelope);
}

export function createSignedPolicyApproval(input: {
  approval: PolicyApproval;
  keyId: string;
  signature: Uint8Array;
}): SignedPolicyApproval {
  const envelope: SignedPolicyApproval = {
    schemaVersion: 1,
    approval: clone(input.approval),
    signature: createSignature(input.keyId, input.signature),
  };
  assertSignedPolicyApproval(envelope);
  return clone(envelope);
}

export function assertSignedPolicyApproval(envelope: SignedPolicyApproval): void {
  if (!validateSchema("signedPolicyApproval", envelope).valid) {
    throw new PolicyContractError("invalid_policy_signature", "signed policy approval이 유효하지 않습니다.");
  }
  assertSignatureEncoding(envelope);
}

export function createSignedPolicyApprovalRevocation(input: {
  revocation: PolicyApprovalRevocation;
  keyId: string;
  signature: Uint8Array;
}): SignedPolicyApprovalRevocation {
  const envelope: SignedPolicyApprovalRevocation = {
    schemaVersion: 1,
    revocation: clone(input.revocation),
    signature: createSignature(input.keyId, input.signature),
  };
  assertSignedPolicyApprovalRevocation(envelope);
  return clone(envelope);
}

export function assertSignedPolicyApprovalRevocation(
  envelope: SignedPolicyApprovalRevocation,
): void {
  if (!validateSchema("signedPolicyApprovalRevocation", envelope).valid) {
    throw new PolicyContractError("invalid_policy_signature", "signed policy revocation이 유효하지 않습니다.");
  }
  assertSignatureEncoding(envelope);
}

export function policySignatureBytes(envelope: SignedPolicyEnvelope): Uint8Array {
  assertSignatureEncoding(envelope);
  return Buffer.from(envelope.signature.value, "base64url");
}

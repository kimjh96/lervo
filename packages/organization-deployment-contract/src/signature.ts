import { type KeyLike, verify } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import {
  type OrganizationDeploymentPolicy,
  type SignedOrganizationDeploymentPolicy,
  validateSchema,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { assertOrganizationDeploymentPolicy } from "./policy.js";
import { clone } from "./shared.js";

function assertKeyId(keyId: string): void {
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(keyId)) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy_signature",
      "The organization policy signature key ID is invalid.",
    );
  }
}

export function organizationDeploymentPolicySigningBytes(input: {
  policy: OrganizationDeploymentPolicy;
  keyId: string;
}): Uint8Array {
  assertOrganizationDeploymentPolicy(input.policy);
  assertKeyId(input.keyId);
  return Buffer.from(
    canonicalJson({
      domain: "lervo.organization-deployment.policy.v1",
      algorithm: "ed25519",
      keyId: input.keyId,
      policy: clone(input.policy),
    }),
    "utf8",
  );
}

export function createSignedOrganizationDeploymentPolicy(input: {
  policy: OrganizationDeploymentPolicy;
  keyId: string;
  signature: Uint8Array;
}): SignedOrganizationDeploymentPolicy {
  assertOrganizationDeploymentPolicy(input.policy);
  assertKeyId(input.keyId);
  if (input.signature.byteLength !== 64) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy_signature",
      "An organization policy Ed25519 signature must be 64 bytes.",
    );
  }
  const envelope: SignedOrganizationDeploymentPolicy = {
    schemaVersion: 1,
    policy: clone(input.policy),
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: Buffer.from(input.signature).toString("base64url"),
    },
  };
  assertSignedOrganizationDeploymentPolicy(envelope);
  return clone(envelope);
}

export function assertSignedOrganizationDeploymentPolicy(
  envelope: SignedOrganizationDeploymentPolicy,
): void {
  if (!validateSchema("signedOrganizationDeploymentPolicy", envelope).valid) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy_signature",
      "The signed organization deployment policy contract is invalid.",
    );
  }
  assertOrganizationDeploymentPolicy(envelope.policy);
  const signature = Buffer.from(envelope.signature.value, "base64url");
  if (signature.byteLength !== 64 || signature.toString("base64url") !== envelope.signature.value) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy_signature",
      "The organization policy signature encoding is invalid.",
    );
  }
}

export function verifySignedOrganizationDeploymentPolicy(input: {
  envelope: SignedOrganizationDeploymentPolicy;
  publicKey: KeyLike;
}): OrganizationDeploymentPolicy {
  assertSignedOrganizationDeploymentPolicy(input.envelope);
  const valid = verify(
    null,
    organizationDeploymentPolicySigningBytes({
      policy: input.envelope.policy,
      keyId: input.envelope.signature.keyId,
    }),
    input.publicKey,
    Buffer.from(input.envelope.signature.value, "base64url"),
  );
  if (!valid) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy_signature",
      "The organization deployment policy signature is invalid.",
    );
  }
  return clone(input.envelope.policy);
}

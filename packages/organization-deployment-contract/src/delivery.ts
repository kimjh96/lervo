import {
  type OrganizationDeploymentPolicy,
  type OrganizationRuntimeCredentialDeliveryReceipt,
  type OrganizationRuntimeCredentialGrant,
  type OrganizationRuntimeCredentialRevocation,
  validateSchema,
} from "@lervo/schemas";

import {
  assertCredentialGrantAgainstPolicy,
  assertOrganizationRuntimeCredentialRevocation,
} from "./credential.js";
import { OrganizationDeploymentError } from "./errors.js";
import { assertOrganizationAuthority } from "./policy.js";
import { clone, contentId, timestamp } from "./shared.js";

export interface RuntimeCredentialSource {
  load(credentialId: string): Promise<Uint8Array>;
}

export interface RuntimeCredentialConsumer {
  activate(input: { grant: OrganizationRuntimeCredentialGrant; secret: Uint8Array }): Promise<void>;
}

function validateBearerMaterial(secret: Uint8Array): void {
  if (
    secret.byteLength < 32 ||
    secret.byteLength > 4_096 ||
    secret.some((byte) => byte < 0x21 || byte > 0x7e)
  ) {
    throw new OrganizationDeploymentError(
      "credential_material_invalid",
      "The runtime credential material does not satisfy the bounded bearer contract.",
    );
  }
}

export async function deliverOrganizationRuntimeCredential(input: {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
  revocations?: OrganizationRuntimeCredentialRevocation[];
  deliveredBy: string;
  deliveredAt: string;
  source: RuntimeCredentialSource;
  consumer: RuntimeCredentialConsumer;
}): Promise<OrganizationRuntimeCredentialDeliveryReceipt> {
  assertCredentialGrantAgainstPolicy(input);
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.deliveredBy,
    permission: "credential.deliver",
    projectId: input.grant.target.projectId,
    at: input.deliveredAt,
  });
  if (input.deliveredBy === input.grant.issuedBy) {
    throw new OrganizationDeploymentError(
      "organization_authority_denied",
      "The credential issuer cannot deliver the same runtime credential.",
    );
  }
  const deliveredAt = timestamp(input.deliveredAt);
  if (
    deliveredAt < timestamp(input.grant.notBefore) ||
    deliveredAt >= timestamp(input.grant.expiresAt)
  ) {
    throw new OrganizationDeploymentError(
      "credential_not_active",
      "The runtime credential is not active at the delivery time.",
    );
  }
  for (const revocation of input.revocations ?? []) {
    assertOrganizationRuntimeCredentialRevocation({
      policy: input.policy,
      grant: input.grant,
      revocation,
    });
    if (timestamp(revocation.revokedAt) <= deliveredAt) {
      throw new OrganizationDeploymentError(
        "credential_revoked",
        "The runtime credential was revoked before delivery.",
      );
    }
  }

  let secret: Uint8Array;
  try {
    secret = await input.source.load(input.grant.credentialId);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "credential_source_failed",
      "The runtime credential source could not load the requested material.",
      { cause: error },
    );
  }
  try {
    validateBearerMaterial(secret);
    try {
      await input.consumer.activate({ grant: clone(input.grant), secret });
    } catch (error) {
      throw new OrganizationDeploymentError(
        "credential_activation_failed",
        "The runtime credential consumer did not confirm activation.",
        { cause: error },
      );
    }
  } finally {
    secret.fill(0);
  }

  const content = {
    schemaVersion: 1 as const,
    organizationId: input.grant.organizationId,
    policyId: input.grant.policyId,
    credentialId: input.grant.credentialId,
    target: clone(input.grant.target),
    nodeId: input.grant.nodeId,
    destinationId: input.grant.destinationId,
    generation: input.grant.generation,
    deliveredBy: input.deliveredBy,
    deliveredAt: input.deliveredAt,
    secretMaterial: "excluded" as const,
  };
  const receipt: OrganizationRuntimeCredentialDeliveryReceipt = {
    ...content,
    deliveryId: contentId("ocd", content),
  };
  if (!validateSchema("organizationRuntimeCredentialDeliveryReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "credential_activation_failed",
      "The runtime credential delivery receipt is invalid.",
    );
  }
  return clone(receipt);
}

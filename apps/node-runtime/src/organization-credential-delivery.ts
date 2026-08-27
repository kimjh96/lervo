import {
  deliverOrganizationRuntimeCredential,
  assertOrganizationRuntimeCredentialGrant,
} from "@lervo/organization-deployment-contract";
import { OwnerOnlyFileRuntimeCredentialSource } from "@lervo/organization-credential-source-file";
import type {
  OrganizationDeploymentPolicy,
  OrganizationRuntimeCredentialDeliveryReceipt,
  OrganizationRuntimeCredentialGrant,
  OrganizationRuntimeCredentialRevocation,
} from "@lervo/schemas";

import { ReloadableNodeBearerToken } from "./credentials.js";
import { NodeRuntimeError } from "./errors.js";

export interface NodeOrganizationCredentialDeliveryRequest {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
  revocations?: OrganizationRuntimeCredentialRevocation[];
  deliveredBy: string;
  deliveredAt: string;
}

export interface NodeOrganizationCredentialBinding {
  nodeId: string;
  destinationId: string;
  target: OrganizationRuntimeCredentialGrant["target"];
  bearerTokenFile: string;
}

export interface NodeOrganizationCredentialDelivery {
  deliver(
    request: NodeOrganizationCredentialDeliveryRequest,
  ): Promise<OrganizationRuntimeCredentialDeliveryReceipt>;
}

function assertLocalBinding(
  binding: NodeOrganizationCredentialBinding,
  grant: OrganizationRuntimeCredentialGrant,
): void {
  assertOrganizationRuntimeCredentialGrant(grant);
  if (
    grant.nodeId !== binding.nodeId ||
    grant.destinationId !== binding.destinationId ||
    grant.target.projectId !== binding.target.projectId ||
    grant.target.projectIdentityHash !== binding.target.projectIdentityHash
  ) {
    throw new NodeRuntimeError(
      "organization_credential_delivery_failed",
      "The organization credential does not match this Node runtime.",
    );
  }
}

export function createNodeOrganizationCredentialDelivery(input: {
  binding: NodeOrganizationCredentialBinding;
  bearerToken: ReloadableNodeBearerToken;
  authenticateCandidate(token: string, requestedAt: string): Promise<void>;
}): NodeOrganizationCredentialDelivery {
  return {
    async deliver(request) {
      assertLocalBinding(input.binding, request.grant);
      const source = new OwnerOnlyFileRuntimeCredentialSource([
        {
          credentialId: request.grant.credentialId,
          filePath: input.binding.bearerTokenFile,
        },
      ]);
      return deliverOrganizationRuntimeCredential({
        ...request,
        source,
        consumer: {
          async activate({ secret }) {
            const candidate = new TextDecoder("utf-8", { fatal: true }).decode(secret);
            await input.authenticateCandidate(candidate, request.deliveredAt);
            input.bearerToken.replace(candidate);
          },
        },
      });
    },
  };
}

import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";

export const organizationDeploymentPermissionSchema = {
  type: "string",
  enum: [
    "deployment.plan",
    "credential.issue",
    "credential.rotate",
    "credential.deliver",
    "credential.revoke",
    "node.enroll",
    "rollout.approve",
    "rollout.execute",
    "rollout.rollback",
  ],
} as const;

export const organizationRuntimePermissionSchema = {
  type: "string",
  enum: [
    "trace.read",
    "sync.write",
    "workstream.read",
    "workstream.write",
    "workspace.read",
    "workspace.coordinate",
    "policy.read",
    "command.read",
    "command.delivery",
    "capability.read",
  ],
} as const;

export const organizationIdSchema = {
  type: "string",
  pattern: "^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const organizationPrincipalIdSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$",
} as const;

export const organizationNodeIdSchema = {
  type: "string",
  pattern: "^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const organizationProjectTargetSchema = {
  type: "object",
  properties: {
    projectId: projectIdSchema,
    projectIdentityHash: sha256Schema,
  },
  required: ["projectId", "projectIdentityHash"],
  additionalProperties: false,
} as const;

export const organizationDeploymentPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-deployment-policy.schema.json",
  title: "Lervo organization deployment policy",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    organizationId: organizationIdSchema,
    sequence: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    previousPolicyId: {
      oneOf: [{ type: "null" }, { type: "string", pattern: "^odp_[a-f0-9]{64}$" }],
    },
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    tenancy: {
      type: "object",
      properties: {
        mode: { type: "string", const: "strict_project" },
        projects: {
          type: "array",
          minItems: 1,
          maxItems: 256,
          items: organizationProjectTargetSchema,
        },
      },
      required: ["mode", "projects"],
      additionalProperties: false,
    },
    authorities: {
      type: "array",
      minItems: 2,
      maxItems: 256,
      items: {
        type: "object",
        properties: {
          principalId: organizationPrincipalIdSchema,
          permissions: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: organizationDeploymentPermissionSchema,
          },
          projectIds: {
            type: "array",
            minItems: 1,
            maxItems: 256,
            uniqueItems: true,
            items: projectIdSchema,
          },
        },
        required: ["principalId", "permissions", "projectIds"],
        additionalProperties: false,
      },
    },
    credentialPolicy: {
      type: "object",
      properties: {
        deliveryMode: { type: "string", const: "runtime_only" },
        separationOfDuties: { type: "string", const: "issuer_and_deliverer_distinct" },
        maximumTtlSeconds: { type: "integer", minimum: 300, maximum: 2_592_000 },
        maximumRotationOverlapSeconds: { type: "integer", minimum: 0, maximum: 86_400 },
        allowedPermissions: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: organizationRuntimePermissionSchema,
        },
      },
      required: [
        "deliveryMode",
        "separationOfDuties",
        "maximumTtlSeconds",
        "maximumRotationOverlapSeconds",
        "allowedPermissions",
      ],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "policyId",
    "organizationId",
    "sequence",
    "previousPolicyId",
    "issuedAt",
    "expiresAt",
    "tenancy",
    "authorities",
    "credentialPolicy",
  ],
  additionalProperties: false,
} as const;

export const signedOrganizationDeploymentPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-organization-deployment-policy.schema.json",
  title: "Lervo signed organization deployment policy",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    policy: { $ref: organizationDeploymentPolicySchema.$id },
    signature: {
      type: "object",
      properties: {
        algorithm: { type: "string", const: "ed25519" },
        keyId: { type: "string", pattern: "^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$" },
        value: { type: "string", pattern: "^[A-Za-z0-9_-]{86}$" },
      },
      required: ["algorithm", "keyId", "value"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "policy", "signature"],
  additionalProperties: false,
} as const;

const credentialGrantProperties = {
  schemaVersion: schemaVersionSchema,
  credentialId: { type: "string", pattern: "^ocg_[a-f0-9]{64}$" },
  organizationId: organizationIdSchema,
  policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
  policyHash: sha256Schema,
  target: organizationProjectTargetSchema,
  nodeId: organizationNodeIdSchema,
  destinationId: syncDestinationIdSchema,
  subjectPrincipalId: organizationPrincipalIdSchema,
  permissions: {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: organizationRuntimePermissionSchema,
  },
  generation: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
  previousCredentialId: {
    oneOf: [{ type: "null" }, { type: "string", pattern: "^ocg_[a-f0-9]{64}$" }],
  },
  issuedBy: organizationPrincipalIdSchema,
  issuedAt: timestampSchema,
  notBefore: timestampSchema,
  expiresAt: timestampSchema,
  material: { type: "string", const: "runtime_only" },
} as const;

export const organizationRuntimeCredentialGrantSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-runtime-credential-grant.schema.json",
  title: "Lervo organization runtime credential grant",
  type: "object",
  properties: credentialGrantProperties,
  required: [
    "schemaVersion",
    "credentialId",
    "organizationId",
    "policyId",
    "policyHash",
    "target",
    "nodeId",
    "destinationId",
    "subjectPrincipalId",
    "permissions",
    "generation",
    "previousCredentialId",
    "issuedBy",
    "issuedAt",
    "notBefore",
    "expiresAt",
    "material",
  ],
  additionalProperties: false,
} as const;

export const organizationRuntimeCredentialRevocationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-runtime-credential-revocation.schema.json",
  title: "Lervo organization runtime credential revocation",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    revocationId: { type: "string", pattern: "^ocr_[a-f0-9]{64}$" },
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    policyHash: sha256Schema,
    credentialId: { type: "string", pattern: "^ocg_[a-f0-9]{64}$" },
    revokedBy: organizationPrincipalIdSchema,
    revokedAt: timestampSchema,
    reason: { type: "string", enum: ["rotated", "compromised", "scope_removed", "retired"] },
  },
  required: [
    "schemaVersion",
    "revocationId",
    "organizationId",
    "policyId",
    "policyHash",
    "credentialId",
    "revokedBy",
    "revokedAt",
    "reason",
  ],
  additionalProperties: false,
} as const;

export const organizationRuntimeCredentialDeliveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-runtime-credential-delivery-receipt.schema.json",
  title: "Lervo organization runtime credential delivery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryId: { type: "string", pattern: "^ocd_[a-f0-9]{64}$" },
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    credentialId: { type: "string", pattern: "^ocg_[a-f0-9]{64}$" },
    target: organizationProjectTargetSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    generation: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    deliveredBy: organizationPrincipalIdSchema,
    deliveredAt: timestampSchema,
    secretMaterial: { type: "string", const: "excluded" },
  },
  required: [
    "schemaVersion",
    "deliveryId",
    "organizationId",
    "policyId",
    "credentialId",
    "target",
    "nodeId",
    "destinationId",
    "generation",
    "deliveredBy",
    "deliveredAt",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export type OrganizationDeploymentPermission = FromSchema<
  typeof organizationDeploymentPermissionSchema
>;
export type OrganizationRuntimePermission = FromSchema<typeof organizationRuntimePermissionSchema>;
export type OrganizationProjectTarget = FromSchema<typeof organizationProjectTargetSchema>;
export type OrganizationDeploymentPolicy = FromSchema<typeof organizationDeploymentPolicySchema>;
export type SignedOrganizationDeploymentPolicy = FromSchema<
  typeof signedOrganizationDeploymentPolicySchema,
  { references: [typeof organizationDeploymentPolicySchema] }
>;
export type OrganizationRuntimeCredentialGrant = FromSchema<
  typeof organizationRuntimeCredentialGrantSchema
>;
export type OrganizationRuntimeCredentialRevocation = FromSchema<
  typeof organizationRuntimeCredentialRevocationSchema
>;
export type OrganizationRuntimeCredentialDeliveryReceipt = FromSchema<
  typeof organizationRuntimeCredentialDeliveryReceiptSchema
>;

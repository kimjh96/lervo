import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  deliberationArtifactIdSchema,
  deliberationClaimIdSchema,
  deliberationIdSchema,
  deliberationObjectionIdSchema,
  deliberationPolicyIdSchema,
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  receiptIdSchema,
  roleIdSchema,
  runIdSchema,
  schemaVersionSchema,
  sessionIdSchema,
  sha256Schema,
  sharedContextIdSchema,
  timestampSchema,
  verificationIdSchema,
  verificationSuiteIdSchema,
} from "./common.js";
import { writingPublicationPermitValueSchema } from "./writing-publication.js";

export const deliberationArtifactKinds = [
  "proposal",
  "objection",
  "revision",
  "verification",
  "decision",
] as const;

const claimSchema = {
  type: "object",
  properties: {
    claimId: deliberationClaimIdSchema,
    claimDigest: sha256Schema,
  },
  required: ["claimId", "claimDigest"],
  additionalProperties: false,
} as const;

const commonProperties = {
  schemaVersion: schemaVersionSchema,
  deliberationArtifactId: deliberationArtifactIdSchema,
  deliberationId: deliberationIdSchema,
  projectId: projectIdSchema,
  policyId: deliberationPolicyIdSchema,
  policyHash: sha256Schema,
  round: { type: "integer", minimum: 1, maximum: 20 },
  producer: {
    type: "object",
    properties: {
      roleId: roleIdSchema,
      runId: runIdSchema,
      sessionId: sessionIdSchema,
      provider: providerSchema,
    },
    required: ["roleId", "runId", "sessionId", "provider"],
    additionalProperties: false,
  },
  content: {
    type: "object",
    properties: {
      artifactId: artifactIdSchema,
      uri: { type: "string", pattern: "^lervo-cas://sha256/[a-f0-9]{64}$" },
      mediaType: { const: "text/markdown; charset=utf-8" },
      contentHash: sha256Schema,
      byteCount: { type: "integer", minimum: 1, maximum: 4_194_304 },
    },
    required: ["artifactId", "uri", "mediaType", "contentHash", "byteCount"],
    additionalProperties: false,
  },
  inputContext: {
    type: "object",
    properties: {
      contextGeneration: { type: "integer", minimum: 0 },
      sharedContextIds: {
        type: "array",
        items: sharedContextIdSchema,
        maxItems: 100,
        uniqueItems: true,
      },
      loadedReceiptIds: {
        type: "array",
        items: receiptIdSchema,
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
      },
      injectedReceiptIds: {
        type: "array",
        items: receiptIdSchema,
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
      },
    },
    required: ["contextGeneration", "sharedContextIds", "loadedReceiptIds", "injectedReceiptIds"],
    additionalProperties: false,
  },
  previousArtifactIds: {
    type: "array",
    items: deliberationArtifactIdSchema,
    maxItems: 100,
    uniqueItems: true,
  },
  evidenceEventIds: {
    type: "array",
    items: eventIdSchema,
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  },
  writingPublicationPermit: writingPublicationPermitValueSchema,
  createdAt: timestampSchema,
} as const;

const commonRequired = [
  "schemaVersion",
  "deliberationArtifactId",
  "deliberationId",
  "projectId",
  "policyId",
  "policyHash",
  "kind",
  "round",
  "producer",
  "content",
  "inputContext",
  "previousArtifactIds",
  "evidenceEventIds",
  "writingPublicationPermit",
  "details",
  "createdAt",
] as const;

const proposalArtifactSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    kind: { const: "proposal" },
    details: {
      type: "object",
      properties: {
        claims: { type: "array", items: claimSchema, minItems: 1, maxItems: 100 },
      },
      required: ["claims"],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const objectionArtifactSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    kind: { const: "objection" },
    details: {
      type: "object",
      properties: {
        reviewStatus: {
          type: "string",
          enum: ["approved", "changes_requested"],
        },
        objections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectionId: deliberationObjectionIdSchema,
              objectionDigest: sha256Schema,
              targetClaimIds: {
                type: "array",
                items: deliberationClaimIdSchema,
                minItems: 1,
                maxItems: 100,
                uniqueItems: true,
              },
              blocking: { type: "boolean" },
              status: { const: "open" },
            },
            required: ["objectionId", "objectionDigest", "targetClaimIds", "blocking", "status"],
            additionalProperties: false,
          },
          maxItems: 100,
        },
      },
      required: ["reviewStatus", "objections"],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const revisionArtifactSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    kind: { const: "revision" },
    details: {
      type: "object",
      properties: {
        revisesArtifactId: deliberationArtifactIdSchema,
        claims: { type: "array", items: claimSchema, minItems: 1, maxItems: 100 },
        resolvesObjectionIds: {
          type: "array",
          items: deliberationObjectionIdSchema,
          maxItems: 100,
          uniqueItems: true,
        },
      },
      required: ["revisesArtifactId", "claims", "resolvesObjectionIds"],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const verificationArtifactSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    kind: { const: "verification" },
    details: {
      type: "object",
      properties: {
        verificationId: verificationIdSchema,
        suiteId: verificationSuiteIdSchema,
        resultArtifactId: artifactIdSchema,
        resultHash: sha256Schema,
        status: { type: "string", enum: ["passed", "failed", "cancelled"] },
        targetClaims: {
          type: "array",
          items: claimSchema,
          minItems: 1,
          maxItems: 100,
        },
      },
      required: [
        "verificationId",
        "suiteId",
        "resultArtifactId",
        "resultHash",
        "status",
        "targetClaims",
      ],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const decisionArtifactSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    kind: { const: "decision" },
    details: {
      type: "object",
      properties: {
        decisionOwnerRoleId: roleIdSchema,
        adoptedClaimIds: {
          type: "array",
          items: deliberationClaimIdSchema,
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
        },
        verificationArtifactIds: {
          type: "array",
          items: deliberationArtifactIdSchema,
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
        },
        unresolvedObjectionIds: {
          type: "array",
          items: deliberationObjectionIdSchema,
          maxItems: 100,
          uniqueItems: true,
        },
      },
      required: [
        "decisionOwnerRoleId",
        "adoptedClaimIds",
        "verificationArtifactIds",
        "unresolvedObjectionIds",
      ],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

export const deliberationArtifactSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-artifact.schema.json",
  title: "Lervo structured deliberation artifact",
  oneOf: [
    proposalArtifactSchema,
    objectionArtifactSchema,
    revisionArtifactSchema,
    verificationArtifactSchema,
    decisionArtifactSchema,
  ],
} as const;

export type DeliberationArtifact = FromSchema<typeof deliberationArtifactSchema>;
export type DeliberationArtifactKind = (typeof deliberationArtifactKinds)[number];

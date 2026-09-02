import type { FromSchema } from "json-schema-to-ts";

import { artifactIdSchema, sha256Schema, timestampSchema } from "./common.js";

const assignmentIdSchema = { type: "string", pattern: "^asn_[a-f0-9]{24}$" } as const;
const agentIdSchema = { type: "string", pattern: "^agt_[a-f0-9]{24}$" } as const;
const leaseIdSchema = { type: "string", pattern: "^lse_[a-f0-9]{24}$" } as const;
const workstreamIdSchema = { type: "string", pattern: "^wks_[a-f0-9]{24}$" } as const;
const completionEvidenceIdSchema = {
  type: "string",
  pattern: "^acp_[a-f0-9]{24}$",
} as const;
const reconciliationCommandIdSchema = {
  type: "string",
  pattern: "^gcr_[a-f0-9]{24}$",
} as const;

export const assignmentCompletionPreparedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-completion-prepared-event-payload.schema.json",
  type: "object",
  properties: {
    completionEvidenceId: completionEvidenceIdSchema,
    workstreamId: workstreamIdSchema,
    assignmentId: assignmentIdSchema,
    assignmentRevision: { type: "integer", minimum: 1 },
    agentId: agentIdSchema,
    leaseId: leaseIdSchema,
    resultArtifactId: artifactIdSchema,
    resultContentHash: sha256Schema,
    verificationStatus: { const: "passed" },
    writingPublicationStatus: { const: "allowed" },
    preparedAt: timestampSchema,
  },
  required: [
    "completionEvidenceId",
    "workstreamId",
    "assignmentId",
    "assignmentRevision",
    "agentId",
    "leaseId",
    "resultArtifactId",
    "resultContentHash",
    "verificationStatus",
    "writingPublicationStatus",
    "preparedAt",
  ],
  additionalProperties: false,
} as const;

export const assignmentCompletionReconciledEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-completion-reconciled-event-payload.schema.json",
  type: "object",
  properties: {
    completionEvidenceId: completionEvidenceIdSchema,
    reconciliationCommandId: reconciliationCommandIdSchema,
    sourceRunId: { type: "string", pattern: "^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    assignmentId: assignmentIdSchema,
    agentId: agentIdSchema,
    leaseId: leaseIdSchema,
    resultArtifactId: artifactIdSchema,
    resultContentHash: sha256Schema,
    revision: { type: "integer", minimum: 2 },
    reconciledAt: timestampSchema,
  },
  required: [
    "completionEvidenceId",
    "reconciliationCommandId",
    "sourceRunId",
    "assignmentId",
    "agentId",
    "leaseId",
    "resultArtifactId",
    "resultContentHash",
    "revision",
    "reconciledAt",
  ],
  additionalProperties: false,
} as const;

export type AssignmentCompletionPreparedEventPayload = FromSchema<
  typeof assignmentCompletionPreparedEventPayloadSchema
>;
export type AssignmentCompletionReconciledEventPayload = FromSchema<
  typeof assignmentCompletionReconciledEventPayloadSchema
>;

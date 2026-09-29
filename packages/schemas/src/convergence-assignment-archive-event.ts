import type { FromSchema } from "json-schema-to-ts";
import { eventIdSchema, sha256Schema, timestampSchema } from "./common.js";

export const convergenceAssignmentArchivedEventPayloadSchema = {
  type: "object",
  properties: {
    assignmentId: { type: "string", pattern: "^asn_[a-f0-9]{24}$" },
    assignmentRevision: { type: "integer", minimum: 1 },
    assignmentHash: sha256Schema,
    obligationId: { type: "string", pattern: "^kconv_[a-f0-9]{24}$" },
    terminalEventId: eventIdSchema,
    terminalEventHash: sha256Schema,
    terminalStatus: { type: "string", enum: ["completed", "failed", "cancelled"] },
    archiveArtifactHash: sha256Schema,
    archivedAt: timestampSchema,
  },
  required: [
    "assignmentId",
    "assignmentRevision",
    "assignmentHash",
    "obligationId",
    "terminalEventId",
    "terminalEventHash",
    "terminalStatus",
    "archiveArtifactHash",
    "archivedAt",
  ],
  additionalProperties: false,
} as const;

export type ConvergenceAssignmentArchivedEventPayload = FromSchema<
  typeof convergenceAssignmentArchivedEventPayloadSchema
>;

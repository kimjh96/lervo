import { sha256Schema } from "./common.js";
export const assignmentAmendedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-amended-event-payload.schema.json",
  type: "object",
  properties: {
    assignmentId: { type: "string", pattern: "^asn_[a-f0-9]{24}$" },
    assignmentRevision: { type: "integer", minimum: 2 },
    assignmentHash: sha256Schema,
    predecessorAssignmentHash: sha256Schema,
    predecessorResponsibilityHash: sha256Schema,
    successorResponsibilityHash: sha256Schema,
  },
  required: [
    "assignmentId",
    "assignmentRevision",
    "assignmentHash",
    "predecessorAssignmentHash",
    "predecessorResponsibilityHash",
    "successorResponsibilityHash",
  ],
  additionalProperties: false,
} as const;

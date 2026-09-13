import { sha256Schema } from "./common.js";

export const assignmentReopenedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-reopened-event-payload.schema.json",
  type: "object",
  properties: {
    assignmentId: { type: "string", pattern: "^asn_[a-f0-9]{24}$" },
    assignmentRevision: { type: "integer", minimum: 2 },
    assignmentHash: sha256Schema,
    kind: { enum: ["rework", "retry"] },
    predecessorAssignmentHash: sha256Schema,
    responsibilityHash: sha256Schema,
    sourceRunId: { type: "string", pattern: "^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    terminalEventId: { type: "string", pattern: "^evt_[A-Za-z0-9_-]{8,128}$" },
    reviewEventId: { type: ["string", "null"], pattern: "^evt_[A-Za-z0-9_-]{8,128}$" },
    attemptNumber: { type: "integer", minimum: 2 },
    predecessorLeaseGeneration: { type: "integer", minimum: 1 },
  },
  required: [
    "assignmentId",
    "assignmentRevision",
    "assignmentHash",
    "kind",
    "predecessorAssignmentHash",
    "responsibilityHash",
    "sourceRunId",
    "terminalEventId",
    "reviewEventId",
    "attemptNumber",
    "predecessorLeaseGeneration",
  ],
  allOf: [
    {
      if: { properties: { kind: { const: "rework" } } },
      then: { properties: { reviewEventId: { type: "string" } } },
      else: { properties: { reviewEventId: { type: "null" } } },
    },
  ],
  additionalProperties: false,
} as const;

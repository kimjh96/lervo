import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema, timestampSchema, workforceAgentIdSchema } from "./common.js";

/**
 * Schema 16: coordination beyond Git in ADE conversations (Lervo ADE coordination, "Event schema
 * 16"). A conversation's lease grows by claims, and a refused claim names its holder by
 * identifiers only. Payloads never carry paths, tool input, command text, file content,
 * conversation titles, the refusal's message, provider session IDs, or tool use IDs.
 */
export const coordinationEventTypes = [
  "assignment.lease.widened",
  "assignment.claim.refused",
] as const;

/** Why a claim was refused; each stopped the write it was made for. */
export const claimRefusalCodes = [
  "path_leased",
  "path_changed_unsealed",
  "path_awaiting_integration",
  "outside_responsibility",
  "path_outside_workspace",
  "lease_path_limit",
] as const;

const assignmentId = { type: "string", pattern: "^asn_[a-f0-9]{24}$" } as const;
const workspaceId = { type: "string", pattern: "^wsp_[a-f0-9]{24}$" } as const;
const leaseGeneration = { type: "integer", minimum: 1 } as const;
/** A conversation assignment holds at most 10,000 path entries. */
const pathCount = { type: "integer", minimum: 1, maximum: 10_000 } as const;

export const assignmentLeaseWidenedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-lease-widened-event-payload.schema.json",
  type: "object",
  properties: {
    assignmentId,
    agentId: workforceAgentIdSchema,
    leaseGeneration,
    revision: { type: "integer", minimum: 1 },
    /** The digest `assignment.claimed` uses, over the lease's sorted path set after widening. */
    expectedPathDigest: sha256Schema,
    expectedPathCount: pathCount,
    addedPathCount: pathCount,
    cause: { type: "string", enum: ["claim", "reconcile"] },
    occurredAt: timestampSchema,
  },
  required: [
    "assignmentId",
    "agentId",
    "leaseGeneration",
    "revision",
    "expectedPathDigest",
    "expectedPathCount",
    "addedPathCount",
    "cause",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const assignmentClaimRefusedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/assignment-claim-refused-event-payload.schema.json",
  type: "object",
  properties: {
    assignmentId,
    agentId: workforceAgentIdSchema,
    leaseGeneration,
    code: { type: "string", enum: claimRefusalCodes },
    /** Each holder field is null where no holder applies, such as a path outside responsibility. */
    holderAgentId: { anyOf: [workforceAgentIdSchema, { type: "null" }] },
    holderAssignmentId: { anyOf: [assignmentId, { type: "null" }] },
    holderWorkspaceId: { anyOf: [workspaceId, { type: "null" }] },
    /**
     * The HMAC-SHA-256 of `lervo.claim.path.v1` and the path, joined by NUL, under the repository
     * instance's local secret, so a replicated event names no guessable path.
     */
    pathDigest: { type: "string", pattern: "^hmac-sha256:[a-f0-9]{64}$" },
    detection: { type: "string", enum: ["tool", "shell", "reconcile"] },
    occurredAt: timestampSchema,
  },
  required: [
    "assignmentId",
    "agentId",
    "leaseGeneration",
    "code",
    "holderAgentId",
    "holderAssignmentId",
    "holderWorkspaceId",
    "pathDigest",
    "detection",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type AssignmentLeaseWidenedEventPayload = FromSchema<
  typeof assignmentLeaseWidenedEventPayloadSchema
>;
export type AssignmentClaimRefusedEventPayload = FromSchema<
  typeof assignmentClaimRefusedEventPayloadSchema
>;

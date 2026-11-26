/**
 * Lervo ADE coordination (schema 16): a conversation's lease widening and a refused claim keep
 * identifiers, counts, digests, and times only, never a path, tool input, or the refusal's message.
 */
export const coordinationPayloadAllowlists = {
  "assignment.lease.widened": [
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
  "assignment.claim.refused": [
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
} as const;
export const coordinationPayloadSchemas = {
  "assignment.lease.widened": "assignmentLeaseWidenedEventPayload",
  "assignment.claim.refused": "assignmentClaimRefusedEventPayload",
} as const;

import { createHash } from "node:crypto";
import { knowledgeConvergenceStages } from "@lervo/schemas";

import type { WorkforceAssignment, WorkforceAssignmentConvergenceProvenance } from "./types.js";
import { canonicalJson as stableJson } from "@lervo/event-contract";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export function validConvergenceProvenance(
  value: unknown,
): value is WorkforceAssignmentConvergenceProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as WorkforceAssignmentConvergenceProvenance;
  return (
    Object.keys(source).sort().join() ===
      [
        "contractVersion",
        "obligationId",
        "baselineEventId",
        "baselineEventHash",
        "stage",
        "inputArtifactHash",
        "delegationHash",
        "agentId",
      ]
        .sort()
        .join() &&
    source.contractVersion === 1 &&
    /^kconv_[a-f0-9]{24}$/u.test(source.obligationId) &&
    /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(source.baselineEventId) &&
    HASH.test(source.baselineEventHash) &&
    knowledgeConvergenceStages.some((stage) => stage === source.stage) &&
    HASH.test(source.inputArtifactHash) &&
    HASH.test(source.delegationHash) &&
    /^agt_[a-f0-9]{24}$/u.test(source.agentId)
  );
}

export function convergenceAssignmentId(
  projectId: string,
  provenance: WorkforceAssignmentConvergenceProvenance,
): string {
  return `asn_${createHash("sha256").update(stableJson({ projectId, provenance })).digest("hex").slice(0, 24)}`;
}

export function convergenceAssignmentMatches(
  existing: WorkforceAssignment,
  expected: Partial<WorkforceAssignment>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => stableJson(existing[key as keyof WorkforceAssignment]) === stableJson(value),
  );
}

export function convergenceAssignmentEventCoordinates(assignment: WorkforceAssignment) {
  const source = assignment.convergence;
  return source == null
    ? {}
    : {
        convergenceContractVersion: source.contractVersion,
        convergenceObligationId: source.obligationId,
        convergenceBaselineEventId: source.baselineEventId,
        convergenceBaselineEventHash: source.baselineEventHash,
        convergenceStage: source.stage,
        convergenceInputArtifactHash: source.inputArtifactHash,
        convergenceDelegationHash: source.delegationHash,
        convergenceAgentId: source.agentId,
      };
}

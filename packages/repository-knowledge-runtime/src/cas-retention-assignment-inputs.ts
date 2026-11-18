import type { EventEnvelope } from "@lervo/schemas";
import { casReferences } from "./cas-retention-references.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

/** The stage input that one convergence `assignment.created` event names (ADR-0585). */
export interface ConvergenceAssignmentInput {
  assignmentId: string;
  obligationId: string;
  /** Bare digest of `convergenceInputArtifactHash`. */
  hash: string;
  /** References in every other payload field; these stay roots like any non-convergence event. */
  otherReferences: string[];
  at: number;
}

/** Null for ordinary assignments; their payloads stay roots under ADR-0534. */
export function convergenceAssignmentInput(
  event: EventEnvelope,
): ConvergenceAssignmentInput | null {
  if (event.type !== "assignment.created") return null;
  const { assignmentId, convergenceObligationId, convergenceInputArtifactHash } = event.payload;
  if (
    typeof assignmentId !== "string" ||
    typeof convergenceObligationId !== "string" ||
    typeof convergenceInputArtifactHash !== "string" ||
    !HASH.test(convergenceInputArtifactHash)
  )
    return null;
  const at = Date.parse(event.occurredAt);
  if (!Number.isFinite(at)) throw new Error("Convergence assignment retention time is invalid.");
  return {
    assignmentId,
    obligationId: convergenceObligationId,
    hash: convergenceInputArtifactHash.slice(7),
    otherReferences: casReferences(
      JSON.stringify({ ...event.payload, convergenceInputArtifactHash: null }),
    ),
    at,
  };
}

/**
 * An archive is the assignment record's bytes, so it names the same input. It stops rooting that
 * input only when the archive event matches the creating event's obligation; otherwise the archive
 * keeps every reference it names.
 */
export function archivedAssignmentInput(
  event: EventEnvelope,
  created: ReadonlyMap<string, ConvergenceAssignmentInput>,
): { archiveHash: string; inputHash: string; assignmentId: string } | null {
  if (event.type !== "assignment.convergence.archived") return null;
  const { assignmentId, obligationId, archiveArtifactHash } = event.payload;
  const input = typeof assignmentId === "string" ? created.get(assignmentId) : undefined;
  if (
    input === undefined ||
    input.obligationId !== obligationId ||
    typeof archiveArtifactHash !== "string" ||
    !HASH.test(archiveArtifactHash)
  )
    return null;
  return {
    archiveHash: archiveArtifactHash.slice(7),
    inputHash: input.hash,
    assignmentId: input.assignmentId,
  };
}

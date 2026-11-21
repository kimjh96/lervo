import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";
import {
  ownerEvidenceReferences,
  ownerHandoffReferences,
} from "./supervision-reasoning-references.js";

/** Recent workstream notes carry the live state; older notes stay in the canonical artifact. */
export const PROMPT_WORKSTREAM_NOTES = 8;

/**
 * The model-facing view of an owner reasoning context. The stored artifact and its canonical
 * verification keep every fact; this view drops the duplicated planning workstream, older notes
 * and the detail of cancelled assignments, which a live decision cannot act on. ADR-0608: it also
 * labels each pending incoming handoff and each result with the short reference a decision cites.
 */
export function ownerReasoningPromptContext(context: OwnerReasoningContext): unknown {
  const { facts } = context;
  const cancelled = new Set(
    facts.assignments
      .filter((assignment) => assignment.status === "cancelled")
      .map((assignment) => assignment.assignmentId),
  );
  const notes = facts.workstream.notes;
  const handoffs = ownerHandoffReferences(facts);
  const evidence = ownerEvidenceReferences(facts);
  return {
    ...context,
    results: context.results.map((result) => ({
      evidenceReference: evidence.referenceOf(result.contentHash) ?? null,
      ...result,
    })),
    facts: {
      ...facts,
      peers: facts.peers.map((peer) => ({
        ...peer,
        incoming: peer.incoming.map((item) => ({
          handoffReference: handoffs.referenceOf(item.handoffHash) ?? null,
          ...item,
        })),
      })),
      handoffs: { ...facts.handoffs, pendingIncoming: [...handoffs.references] },
      workstream: {
        ...facts.workstream,
        notes: notes.slice(-PROMPT_WORKSTREAM_NOTES),
        omittedOlderNoteCount: Math.max(0, notes.length - PROMPT_WORKSTREAM_NOTES),
      },
      assignments: facts.assignments.map((assignment) =>
        cancelled.has(assignment.assignmentId)
          ? {
              assignmentId: assignment.assignmentId,
              status: assignment.status,
              failureCode: assignment.failureCode,
            }
          : assignment,
      ),
      responsibilities: facts.responsibilities.map((item) =>
        cancelled.has(item.assignmentId)
          ? { assignmentId: item.assignmentId, binding: "omitted_cancelled" }
          : item,
      ),
    },
    planning: { ...context.planning, workstream: "identical_to_facts.workstream" },
  };
}

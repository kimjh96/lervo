import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";

/** Recent workstream notes carry the live state; older notes stay in the canonical artifact. */
export const PROMPT_WORKSTREAM_NOTES = 8;

/**
 * The model-facing view of an owner reasoning context. The stored artifact and its canonical
 * verification keep every fact; this view drops the duplicated planning workstream, older notes
 * and the detail of cancelled assignments, which a live decision cannot act on.
 */
export function ownerReasoningPromptContext(context: OwnerReasoningContext): unknown {
  const { facts } = context;
  const cancelled = new Set(
    facts.assignments
      .filter((assignment) => assignment.status === "cancelled")
      .map((assignment) => assignment.assignmentId),
  );
  const notes = facts.workstream.notes;
  return {
    ...context,
    facts: {
      ...facts,
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

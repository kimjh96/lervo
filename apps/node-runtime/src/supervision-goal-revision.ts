import type { SupervisionTaskSource } from "./supervision-task-source.js";

type TaskSource = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

/** A bound responsibility whose goal moved on; it may only be revised, never prepared or dispatched. */
export interface StaleResponsibilityFact {
  assignmentId: string;
  executorAgentId: string;
  boundWorkstreamRevision: number;
  currentWorkstreamRevision: number;
  leaseExpiresAt: string | null;
  started: boolean;
}

/** Lists every non-terminal assignment whose current binding predates the current goal revision. */
export function staleResponsibilityFacts(source: TaskSource): StaleResponsibilityFact[] {
  const current = source.workstream.revision;
  const facts: StaleResponsibilityFact[] = [];
  for (const entry of source.responsibilities) {
    const binding = entry.binding;
    const assignment = source.assignments.find((item) => item.assignmentId === entry.assignmentId);
    if (
      binding === null ||
      assignment === undefined ||
      ["completed", "failed", "cancelled"].includes(assignment.status) ||
      binding.workstreamRevision >= current
    )
      continue;
    facts.push({
      assignmentId: entry.assignmentId,
      executorAgentId: binding.responsibility.executorAgentId,
      boundWorkstreamRevision: binding.workstreamRevision,
      currentWorkstreamRevision: current,
      leaseExpiresAt: assignment.lease?.expiresAt ?? null,
      started: source.execution.attempts.some(
        (attempt) => attempt.assignmentId === entry.assignmentId,
      ),
    });
  }
  return facts.sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
}

/** Fails closed before any workspace or provider effect for a responsibility bound under an older goal. */
export function assertResponsibilityGoalCurrent(source: TaskSource, assignmentId: string): void {
  const stale = staleResponsibilityFacts(source).find((item) => item.assignmentId === assignmentId);
  if (stale !== undefined)
    throw new Error(
      `The responsibility for ${assignmentId} was bound under goal revision ${stale.boundWorkstreamRevision}; the goal is now revision ${stale.currentWorkstreamRevision}. Revise the responsibility before preparing or dispatching it.`,
    );
}

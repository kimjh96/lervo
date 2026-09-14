/** Checks ancestry only after the canonical responsibility reader has validated the whole chain. */
export function hasSupervisionRecoveryAncestor(input: {
  events: readonly {
    eventId: string;
    type: string;
    payload: Record<string, unknown>;
  }[];
  supervisionId: string;
  workstreamId: string;
  assignmentId: string;
  currentBindingEventId: string;
  recoveryResponsibilityHash: string;
}): boolean {
  const history = input.events.filter(
    (event) =>
      event.type === "work.responsibility.bound" &&
      event.payload.supervisionId === input.supervisionId &&
      event.payload.workstreamId === input.workstreamId &&
      event.payload.assignmentId === input.assignmentId,
  );
  return (
    history.length > 0 &&
    history.length <= 64 &&
    history.at(-1)?.eventId === input.currentBindingEventId &&
    history.some(
      (event) => event.payload.predecessorBindingHash === input.recoveryResponsibilityHash,
    )
  );
}

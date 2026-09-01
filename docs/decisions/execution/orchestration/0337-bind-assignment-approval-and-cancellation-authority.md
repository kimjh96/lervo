# ADR-0337: Bind assignment approval evidence and cancellation transitions

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The governed-loop v1 projection could wait for approval and recommend cancellation, but
it intentionally had neither an approval authority adapter nor a cancellation writer.
Treating a requirement string, command-line flag, expired lease, or controller decision
as authority would let presentation or timing silently change canonical work state.

## Decision

Extend the provider-neutral application contract with an `ApprovalAuthorityPort`. Its
bounded query names the project, workstream, assignment, and domain-separated requirement
digest. A verified observation must bind an opaque approval ID, authority ID, authority
evidence hash, grant time, and expiry. Missing and invalid observations remain distinct.
The controller accepts a verified observation only for the exact assignment-requirement
coordinate and only while its evidence interval is current. Duplicate, foreign, malformed,
or expired evidence makes the approval observation set invalid. The default CLI composition
has no authority adapter and therefore continues to wait; a CLI argument is never promoted
to verified approval.

Add a pure, content-addressed cancellation plan for one assignment and a workforce-owned
apply transition. The plan binds the assignment ID, revision, current status, reason, and
dependency evidence. Apply recomputes the plan under the existing scheduler lock and
requires the exact plan ID. Only queued or blocked assignments may be cancelled. A leased
assignment remains blocked even after lease expiry because expiry does not prove provider
termination. Terminal assignments are current and are never rewritten.

Cancellation changes assignment status to `cancelled`, clears no unproven result, increments
the revision, and appends `assignment.cancelled` in the same existing state/event rollback
boundary. Requested cancellation and dependency propagation use distinct reason codes.
Dependency propagation is valid only when a named direct dependency is already cancelled.
The headless controller remains a pure recommender; the CLI exposes explicit plan then exact
apply operations and never cascades multiple mutations as one hidden action.

## Privacy and failure meaning

Approval queries and reports contain opaque IDs, hashes, status, and times. They exclude
requirement text, approver identity, credentials, signatures, and evidence bodies.
`assignment.cancelled` contains assignment ID, previous status, cancellation reason, plan
ID, dependency IDs, and resulting revision. It excludes paths, task and acceptance prose,
lease session details, provider output, and actor identity.

Missing authority evidence means `approval_missing`; malformed, foreign, duplicated,
expired, or unverifiable evidence means `approval_observation_invalid`. A cancellation plan
mismatch means no mutation. Active or expired leased work means `active_lease`; it is not
cancelled. Event failure restores the assignment bytes and records no successful transition.

## Consequences

Products may plug in local, Hub, or organization approval authorities without changing the
controller or graph store. Lervo does not claim that a model approved itself. Cancellation
becomes durable and observable one assignment at a time while uncertain running work stays
protected. Provider-stop evidence and batch cancellation remain later, separate contracts.

## References

- [Governed loop and assignment graph roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [Headless governed loop](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)

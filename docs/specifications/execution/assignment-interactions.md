# Assignment interactions, mentions, and inboxes

Status: `active`
As of: 2026-09-02

## Scope

This specification defines local assignment mention planning and the rebuildable thread and inbox report. It adds no chat database, task store, provider invocation, external delivery, or approval authority. The current workforce assignment and `assignment.handoff.recorded` remain canonical.

## Mention route plan

A route plan binds the project, current workstream, assignment and revision, source agent and role contract, exact lease, source handoff-policy digest, target, candidate and recipient coordinates, recipient role contract, request digest, artifact references, context-evidence event IDs, and observed status. Its ID is content-derived. Observation time does not create a new ID while the same lease and decision remain current; lease expiry changes the bounded decision and plan.

V1 targets are exact `@agent:<agent-id>`, unique active `@role:<role-id>`, `@manager` through the source agent's durable parent, and `@reviewer` or `@verifier` through those exact role IDs. A role-like target with zero or multiple active agents is unresolved. Inactive identity, self-routing, source or assignment mismatch, disallowed recipient role, and expired or foreign leases are blocked. The resolver neither heuristically selects a candidate nor creates multiple hidden effects.

Apply requires the exact current plan ID and delegates one mutation to the existing workforce handoff transition. That transition revalidates both role contracts, the source lease, recipient role policy, state revision, and state/event commit boundary. A ready plan is not an effect; `assignment.handoff.recorded` is route-success evidence.

## Thread and inbox projection

`@lervo/application-contract` owns the storage-free query and report. `@lervo/work-controller` projects one deterministic thread for each selected current-workstream assignment and one inbox item for each recorded recipient handoff. It validates duplicate assignments and handoffs and missing agent coordinates. Unknown requested assignments or recipients are invalid, not successful empty results.

Routes expose assignment, thread, handoff, sender, recipient, request digest, artifact and context-event coordinates, artifact count, and route time. Bodies are never loaded. The only V1 route state is `recorded`; delivery and acknowledgment are always `unobserved`. A renderer or future connector cannot upgrade either state without its own exact evidence contract.

`lervo loop thread` and `lervo loop inbox` are read-only. The local operating board composes the same report and has no mutation control. `lervo assignment mention` is a separate plan/apply entrypoint and pairs `--apply` with `--write`.

Outbound connector delivery is a separate exact-effect contract and cannot infer or mutate these interaction projections; see [assignment connector delivery](assignment-connectors.md).

## Privacy and failure meaning

Plans and reports exclude message, task, and acceptance bodies; repository paths; prompts; provider output; reasoning; credentials; actor prose; and reversible external platform identifiers. Message or request material remains in separately governed content-addressed artifacts.

Resolution proves only that one candidate met current identity and policy checks. Route recording proves only that the handoff state and event committed. Neither proves provider receipt, delivery, acknowledgment, understanding, action, review, verification, consensus, assignment creation, or deliberation. A stale plan or failed transition records no route. Missing delivery evidence remains unobserved and is never represented as success, failure, zero, or negative acknowledgment.

## Required verification

Focused tests cover exact agent, unique role, manager, reviewer, and verifier targeting; ambiguous, inactive, self, disallowed-role, workstream, and lease failures; role-policy plan binding; exact plan/apply; content-free deterministic projection; unknown-coordinate invalidation; read-only CLI inspection; escaped self-contained board rendering; and no delivery or acknowledgment inference.

## References

- [Assignment connector delivery](assignment-connectors.md)
- [Execution and evidence specification](../execution.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0342](../../decisions/execution/orchestration/governed-work/0342-project-assignment-interactions-from-workforce-handoffs.md)

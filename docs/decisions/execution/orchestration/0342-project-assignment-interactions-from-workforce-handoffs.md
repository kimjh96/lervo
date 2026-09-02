# ADR-0342: Project assignment interactions from workforce handoffs

- Status: `accepted`
- Decision date: 2026-09-02

## Context

Lervo had exact agent identity, assignment leases, artifact-bound handoffs, and formal
deliberation, but operators could not address an agent or role conversationally and then inspect
the resulting assignment thread or recipient inbox. Creating a chat or task database for this
surface would duplicate workforce authority and weaken the distinction between a recorded route,
delivery, acknowledgment, and action.

## Decision

Use the existing workforce handoff as the canonical assignment-interaction route. A mention route
plan binds the current project, workstream, assignment revision, source agent, exact lease, target,
request digest, artifact references, and context-evidence event IDs. Apply requires the exact plan
ID and delegates mutation to the existing `recordAssignmentHandoff` transition, which revalidates
the source and recipient role contracts, active source lease, role handoff policy, state revision,
and event commit boundary.

V1 accepts exact `@agent:<agent-id>` and `@role:<role-id>` targets, `@manager` through the source
agent's recorded parent, and `@reviewer` or `@verifier` through exact role IDs. A role-like target
must resolve to exactly one active agent. Missing, inactive, ambiguous, self, disallowed-role,
foreign-workstream, stale-lease, and expired-lease results remain blocked. A mention cannot select
one candidate heuristically, create multiple hidden handoffs, switch provider, start deliberation,
or expand task authority.

Add a storage-free application report and pure work-controller projection. One deterministic
thread exists per current-workstream assignment. Its routes are rebuilt from the assignment's
handoffs. Each recipient inbox item points to the same handoff, thread, assignment, sender,
recipient, artifact count, and route time. The projection reports only `routeState=recorded`;
delivery and acknowledgment remain `unobserved`. It never loads artifact bodies or infers provider
receipt, understanding, action, review, verification, or consensus.

The CLI exposes read-only `lervo loop thread` and `lervo loop inbox` routes and enriches the local
operating board through the same report. `lervo assignment mention` first returns a content-bound
plan and applies only when `--apply` is paired with `--write`. External Slack, Discord, Hub, or
Buzz-like connectors remain adapters outside this slice and cannot convert a room mention into
assignment authority.

## Privacy and failure meaning

The application report retains opaque assignment, handoff, agent, artifact, context-event, and
digest coordinates plus bounded status and time. It excludes message and task bodies, acceptance
text, repository paths, prompts, provider output, reasoning, credentials, external reversible
identifiers, and actor prose. Bodies remain separately governed content-addressed artifacts.

A ready plan means one current active recipient was resolved under the observed workforce and
source role policy; it is not routing success. `assignment.handoff.recorded` remains the sole
success evidence for the route. A stale plan or any failed handoff revalidation records no route.
An invalid projection exposes duplicate or missing workforce coordinates and does not repair them.
No route evidence means delivery and acknowledgment are unobserved rather than false or zero.

## Consequences

Paperclip-like assignment threads and inboxes become available without another collaboration
engine or mutable task store. Product clients can replace the CLI and HTML renderer while using
the same provider-neutral report. Team expansion, provider nomination, external delivery,
acknowledgment transitions, assignment creation from mentions, and explicit debate remain separate
authority-bearing contracts.

## References

- [Governed loop and assignment graph roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [Conflict-safe repository agent workforce](0205-conflict-safe-repository-agent-workforce.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
- [Assignment interaction specification](../../../specifications/execution/assignment-interactions.md)
- [Agent mentions, collaboration, and deliberation research](../../../research/paperclip-lervo-collaboration-and-mentions.md)

# ADR-0643: Record which agents are Lervo's own

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0205](0205-conflict-safe-repository-agent-workforce.md) (an agent records whether it is the team's or Lervo's own, and Lervo's own neither count toward the team nor fill the registry with retired records)
Related: [ADR-0637](../applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md), [ADR-0222](0222-isolated-agent-workspace-lifecycle.md)

## Context

Knowledge convergence and practice learning hire their workers as agents, under the convergence delegation's parent, and seeding hires the Knowledge Steward. They live in the same registry as the team the owner hired, with the same record shape. On 2026-11-26 this repository listed 13 active agents, 9 of them Lervo's, and more than 25 retired workers, because every delegation renewal hires a fresh set.

Nothing records which agents are Lervo's. The core recognizes them by name and parent (`convergence-roster.ts`), and the ADE's sidebar had to fold them into one row, "9 run by Lervo", which the owner could not place. Asked whether they are hired at all, the owner chose to keep them agents but record the difference.

## Decision

- Lervo's maintenance workers stay agents in the same coordination model as the team. They change repository bytes the team may change too, so the same leases, assignments, and evidence keep either from overwriting the other (ADR-0205, ADR-0222).
- Every agent records `origin`: `team` for an agent the owner, onboarding, or a team agent hired, and `lervo` for one a Lervo service hired. Convergence, practice learning, and seeding hire with `origin: lervo`; `lervo agent hire`, the core link's `agent.hire`, onboarding, and agent-initiated hires record `team`.
- A record without `origin` is migrated once by today's rule: the convergence delegation's parent and everything under it, the Knowledge Steward and everything under it, and convergence or practice workers by name are `lervo`; any other agent is `team`. Until the migration runs, readers apply the same rule.
- Lervo's agents count neither toward the team's headcount nor toward the registry's 256-agent bound. Retired Lervo workers are pruned to the most recent 32, kept long enough for their assignments' evidence to resolve; team agents are never pruned.
- The ADE's sidebar lists only the team. Lervo's agents surface only when one stops or needs the owner, through the existing health and attention reports.

## State, events, privacy, and failure meaning

- `origin` is an optional field of the agent record at schema version 1. Readers that do not know it keep it, since every transition spreads the record. The `agent.registered` event payload gains `origin`, added to its redaction allowlist.
- Pruning removes retired `lervo` records whose last assignment closed; it records no event, since the registry is local operational state. An agent with an open assignment or lease is never pruned.
- A record whose `origin` is neither `team` nor `lervo` is invalid (`agent_invalid`), as any other malformed field is.

## Consequences

- The ADE and the terminal read the team from a recorded fact, not a name.
- Supervision's hash of all agents changes once, when the migration writes `origin`.
- The core change spans the agent workforce, the CLI, and repository-knowledge runtime; it is delivered with the core's owner of knowledge convergence.

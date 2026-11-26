# ADR-0205: Conflict-safe repository agent workforce

- Status: accepted
- Decision date: 2026-08-25
- Amended by: [ADR-0643](0643-record-which-agents-are-lervos-own.md) (agents record whether they are the team's or Lervo's own)

## Context

Reusable roles and evidence-bound handoffs existed, but repository-scoped agent identity, durable assignments, same-role concurrency, and subagent lifecycle did not. Provider sessions are too temporary to serve as identities, conversation text is not a safe task queue, and concurrent agents need a deterministic pre-execution write-conflict boundary.

## Decision

Create a local repository workforce with six validated built-in role templates: developer, researcher, marketer, designer, writer, and ideation. A durable agent binds an opaque ID, exact role-profile and capability hashes, provider allowance, skills, responsibility paths, lifecycle revision, and optional parent. Root agents and subagents use the same registration, status, assignment, lease, handoff, and completion contracts. Parentage changes only delegation depth, which is limited to eight levels. [ADR-0209](0209-versioned-repository-role-contracts.md) later admits versioned repository-defined specialization and composition through this lifecycle.

Assignments have stable IDs, role, task type, priority, dependencies, acceptance criteria, verification suites, approval requirements, expected paths, optional workstream, lease, handoffs, result artifacts, status, and revision. Ignored state is created lazily under `.lervo/state/workforce/`. Owner-only files, bounded exact validation, atomic replacement, short critical-section locks, stale local-process lock recovery, and compare-and-swap revisions prevent silent overwrites.

Claims use one short scheduler critical section. Dependencies must be complete, and the agent must be active, role-compatible, and responsible for every assignment path. Any active lease with an overlapping exact or ancestor path blocks a claim regardless of role. Disjoint assignments may run concurrently, including assignments for the same role. Expired leases may be reclaimed with a higher generation; current owners may renew within bounded duration. Handoff and completion bind the exact agent, session, lease, and unexpired time and revalidate exact pre-transition bytes under the scheduler lock.

The registered responsibility scopes `.` and `*` both denote the repository root. They cover normalized relative repository paths and overlap every valid repository path for lease exclusion. Workforce admission, ancestry observations, managed execution, and workspace change partitioning use the same pure path policy. Absolute paths, parent traversal, and unnormalized paths never acquire authority through a root scope. This interpretation preserves existing root-scoped agent identities; it does not broaden bounded scopes such as `docs` or admit root markers into an operating mandate's explicit path schema.

Handoffs bind source and recipient agent IDs, request digest, exact artifact IDs and hashes, and context-evidence event IDs. Role policy must permit the recipient; shared conversation memory is never assumed. Managed `lervo run` may bind assignment, agent, and lease coordinates and, before provider creation, verifies the provider, role, expected write paths, and exact verification-suite set. A publishable verified result completes the assignment; other results fail it.

Each committed state mutation records one canonical event while holding the transition; event failure restores the previous bytes. Events are `agent.registered`, `agent.status.changed`, `assignment.created`, `assignment.claimed`, `assignment.lease.renewed`, `assignment.handoff.recorded`, and `assignment.completed`. Payloads contain opaque IDs, role/task/status coordinates, hashes, bounded arrays, lease generation and expiry, and time. They exclude acceptance prose, prompts, provider output, filesystem paths, credentials, skill content, reasoning, and artifact bodies. Without an event, the mutation did not commit. Busy, stale, dependency, scope, lease, or event failures do not imply execution.

Managed execution accepts every validated built-in or repository role ID and binds the exact role version and contract hash to the leased assignment before provider creation. Repository instructions require agents to translate explicit natural-language hiring, assignment, progress, pending-decision, handoff, and retirement requests into operations without asking users for bookkeeping commands. Ambiguous scope or authority creates one bounded pending decision. Every spawned subagent must register its parent and use the normal workforce contract.

## Consequences

Multiple root agents and nested subagents can coordinate without identity or path collisions. The scheduler lock serializes claims, not execution, so disjoint work scales concurrently. Optional Hub replication of rosters or assignments cannot transfer approval authority.

## References

- [Evidence-bound specialist roles](0051-evidence-bound-multi-discipline-roles.md)
- [Managed provider role registry](../providers/0155-managed-provider-role-registry.md)
- [Execution specification](../../../specifications/execution.md)

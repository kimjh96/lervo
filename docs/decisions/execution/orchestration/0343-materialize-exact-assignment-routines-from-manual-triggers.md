# ADR-0343: Materialize exact assignment routines from manual triggers

- Status: `accepted`
- Decision date: 2026-09-02

## Context

Lervo could project and manually operate an assignment graph but operators still had to recreate
repeatable assignment sets one command at a time. Treating recurring prompt text as a routine would
bypass role, capability, path, verification, approval, lease, and evidence owners. A scheduler or
routine database would duplicate assignment authority before unattended recovery and external
trigger policy exist.

## Decision

Define a versioned storage-free routine request containing one exact assignment template and one
manual trigger observation. Templates bind role version and contract hash, nullable required agent
capability hash, paths, verification, approvals, dependencies, and one of three bounded concurrency
policies. V1 accepts at most 32 acyclic nodes, 16 active bounded-enqueue instances, and no trigger
kind other than manual.

The pure work controller validates and content-hashes the template, expands local dependencies, and
derives deterministic invocation and assignment IDs from project, workstream, template, idempotency,
and node coordinates. Its printable plan retains only IDs, role and capability bindings, and
materialization digests. It contains no task, acceptance, approval, or path prose.

Exact apply rechecks the plan under a transient workforce routine lock, then delegates each node to
the existing assignment creation transition. Assignment state gains optional capability and routine
provenance. Claim enforces a non-null capability hash. `assignment.created` gains the same bounded
coordinates and an approval digest under its existing allowlist and state/event rollback boundary.
No new event type or durable routine store is introduced.

Multi-node materialization is explicitly convergent rather than presented as an atomic batch.
Successful node events remain canonical if a later node fails. Deterministic IDs make retry
idempotent, and the next exact plan resumes only missing nodes after verifying all existing nodes.
Stale or mismatched state blocks rather than overwrites.

`skip_if_active` records no association and creates nothing. `coalesce_if_active` identifies one
exact active invocation without mutating it. `enqueue_bounded` creates another invocation only below
its limit. These are admission decisions, not execution scheduling. Materialization never claims,
leases, starts, retries, or completes provider work.

## Privacy and failure meaning

Routine state and events retain opaque routine, template, invocation, trigger, node, role,
capability, assignment, dependency, workstream, and digest coordinates. They exclude template and
task bodies, acceptance and approval prose, paths, prompts, outputs, reasoning, credentials, and
external identifiers. A materialization receipt proves only assignment state and creation-event
commit.

Malformed or cyclic templates fail before planning. Foreign workstreams, stale roles, invalid
existing nodes, capacity and concurrency limits produce no mutation. Plan drift fails before the
first node. A later-node failure leaves an exact partial invocation which must be replanned; it does
not roll back already committed events or start provider work.

## Consequences

Paperclip-like repeatable work becomes available through repository-native workforce authority.
Products may present richer routine editors without owning execution state. Cron, timers, webhooks,
Hub triggers, Buzz-like connectors, automatic claims, and arbitrary prompt execution remain later
authority-bearing contracts.

## References

- [Assignment routine specification](../../../specifications/execution/assignment-routines.md)
- [Governed loop roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [Recommended Paperclip operating model](../../../research/paperclip-lervo-comparison/recommendations/operating-model.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)

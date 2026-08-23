# ADR-0137: Deliberation Leases and ID-Based Diagnostics

- Status: accepted
- Decision date: 2026-08-21

## Context

An approved checkpoint may still be executing before the next event is recorded, and per-run traces do not summarize a multi-role deliberation.

## Decision

From approval through termination, the owner-only `checkpoints/active.json` contains the deliberation ID, random owner ID, PID, and acquisition time. It never contains a topic, body, or secret. Original execution creates it before the checkpoint and removes only its own lease on controlled termination.

Resume fails with `deliberation_in_progress` when the PID is live or ambiguously reused. Only a definitely dead lease may be atomically moved to a unique stale file before exclusive acquisition; races produce one owner.

`lervo deliberate status <id>`, `lervo trace --deliberation <id>`, and `lervo doctor --deliberation <id>` share one read-only diagnostic engine. Within 1,000 events, it validates the event chain and relates start, artifact, and completion events to the checkpoint, lease, role-producing runs, and checkpoint-evidence runs. It distinguishes review rounds, post-approval execution, interruption candidates, and completion. Pre-approval history without a lease is incomplete.

`candidate` is diagnostic, not authority. Resume must still revalidate every source and acquire the lease. Existing doctor and run-trace schemas remain unchanged; an additive deliberation report and capability description are used.

## Consequences

Diagnostics distinguish active work from potentially interrupted work without guessing unobservable liveness. They never mutate state or auto-resume.

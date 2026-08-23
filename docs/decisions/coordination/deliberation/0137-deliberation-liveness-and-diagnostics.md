# ADR-0137: Deliberation Leases and ID-Based Diagnostics

- Status: accepted
- Decision date: 2026-08-21

## Context

An approved checkpoint may still be executing before the next event is recorded, and per-run traces do not summarize a multi-role deliberation.

## Decision

From approval to termination, owner-only checkpoints/active.json contains deliberation ID, random owner ID, PID, and acquisition time—never topic, body, or secret. Original execution creates it before the checkpoint and removes only its own lease on controlled termination.

Resume fails with deliberation_in_progress for a live or ambiguously reused PID. Only a definitely dead lease is atomically moved to a unique stale file before exclusive acquisition; races yield one owner.

lervo deliberate status <id>, lervo trace --deliberation <id>, and lervo doctor --deliberation <id> share one read-only diagnostic engine. It validates the event chain and relates start/artifact/completion, checkpoint, lease, role-producing runs, and checkpoint evidence runs within 1,000 events. It distinguishes review rounds, post-approval running, interruption candidate, and completion. Pre-approval history without a lease is incomplete.

candidate is diagnostic, not authority. Resume must still revalidate all sources and acquire the lease. Existing doctor and run-trace schemas remain; an additive deliberation report and capability description are used.

## Consequences

Diagnostics distinguish active and potentially interrupted work without guessing unobservable liveness, and never mutate or auto-resume.

# Foundation-hardening roadmap

Status: `active`

As of: 2026-09-01

## Outcome

Make Lervo's existing local-first execution boundary measurable, recoverable,
compatible, secure, and capacity-bounded before adding governed loops, richer execution
graphs, or Paperclip- and Buzz-like product surfaces.

This roadmap converts the accepted
[foundation-hardening research](../research/lervo-foundation-hardening.md) into an
implementation program. It does not reopen completed v0 acceptance and does not claim
that any planned contract is already available.

## Scope boundary

Foundation hardening includes:

- reader-first event evolution and historical replay;
- one causal work envelope for current managed execution;
- provider-neutral resource observations and stage timing;
- shared local and Hub read models;
- recovery, concurrency, security, privacy, capacity, and drift proof; and
- an evidence-bound completion audit.

It excludes loop scheduling, execution-graph state, goals, routines, product boards,
collaboration threads, billing, monetary enforcement, dynamic graph mutation, and
unattended autonomy. Those are consumers of the foundation, not shortcuts around it.

## Architectural decision

[ADR-0331](../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md)
defines the irreversible contract: deploy version 2 readers before version 2 writers,
bind every managed run to a causal work ID, record only observed resource and stage
facts, and derive one shared work report.

The [architecture and contract map](foundation-hardening/architecture-and-contracts.md)
assigns ownership. The [delivery tracks](foundation-hardening/delivery-tracks.md) define
the ordered implementation. The
[verification and handoff contract](foundation-hardening/verification-and-handoff.md)
defines when foundation work is actually complete and when enhancement may begin.

## Ordered milestones

1. **FH0 — compatibility bootstrap:** mixed-version readers, fixtures, negotiation, and
   explicit writer activation.
2. **FH1 — causal work envelope:** root, retry, repair, subagent, evaluation, and
   verification ancestry for current managed paths.
3. **FH2 — resource ledger and work report:** normalized provider observations, typed
   missing states, and one CLI/Hub projection.
4. **FH3 — stage timing and hook performance:** bounded spans, representative baselines,
   diagnosis, optimization, and regression budgets.
5. **FH4 — adverse-condition proof:** recovery, idempotency, concurrency, cancellation,
   security, privacy, capacity, migration, and drift.
6. **FH5 — foundation readiness:** aggregate checks, packed and fresh-clone journeys,
   rollback evidence, and reviewed handoff.

FH0 and FH1 are sequential. FH2 and FH3 may proceed independently after FH1. FH4 uses
their evidence and contracts. FH5 requires all preceding milestones.

Implementation state on 2026-09-01: FH0, FH1, and FH2 are implemented. FH3 is the next
bounded milestone; its timing and hook-performance evidence will extend the existing
work report without changing resource accounting ownership.

## Go/no-go boundary

No durable loop or execution-graph implementation begins before FH5 is accepted. This
is deliberately stricter than treating a loop as part of foundation proof: an automatic
loop would multiply any unresolved accounting, timeout, retry, recovery, or authority
error.

After FH5, the first enhancement is one bounded governed-loop and assignment-graph
vertical slice over the public contracts:

```text
trigger -> checkpoint -> managed attempt -> observe -> verify
        -> complete | bounded retry | block | escalate
```

That slice is followed by a minimal local operating client. Paperclip-like operating
routes and Buzz-like collaboration routes then remain replaceable products over Lervo
authority rather than alternate databases or interfaces embedded in the core.

## Status discipline

A milestone is complete only when its linked acceptance evidence names exact versions,
fixtures, environment profiles, measurements, failures, unsupported states, and rollback
results. A passing general repository check, a workstream status, or one successful hook
sample is not sufficient.

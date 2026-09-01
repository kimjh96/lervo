# Foundation-hardening delivery tracks

Status: `active`

As of: 2026-09-01

## Delivery rule

Each track is a separately reviewable implementation tranche with its own release intent
when CLI or bundled-private behavior changes. Every tranche runs the relevant adapter
contracts, lifecycle checks, and base-bound release completion check before completion.

## FH0: Compatibility bootstrap

Implement version 2 readers before version 2 writers.

Deliverables:

- version-discriminated event schemas and typed unsupported-version failures;
- mixed v1/v2 hashing, redaction, append, replay, trace, and sync contracts;
- historical v1 fixtures plus valid and invalid mixed-chain fixtures;
- reader capability advertisement for local runtime, Node, Hub, and sync peers;
- `.lervo/data/event-contract.json` plan/apply and recovery; and
- reader-first deployment and rollback runbooks.

Acceptance requires old v1 fixtures to produce unchanged v1 projections, all current
readers to consume mixed fixtures, v1-only readers to fail before mutation, activation
to block on an incapable peer, and the writer to remain v1 by default.

Implementation state on 2026-09-01: FH0 is implemented. The shared
schema and event-contract readers accept versions 1 and 2, distinguish invalid from
unsupported envelopes, preserve mixed chains through local SQLite reads, sync, Hub
storage, diagnostics, and trace, and keep every production writer pinned to version 1.
The three version 2 payload schemas are readable but have no production emitter. A
shared secret-free capability report advertises `[1, 2]` from the local trace surface,
Node health, Hub health, and the identity-bound sync transport without granting writer
authority. A real tarball consumer proves that same report and exact mixed-history trace
through installed bytes. Local-only repositories now have a default-v1 managed writer
coordinate, bounded capability evidence, exact plan/apply, durable recovery, selected
SQLite writer injection, explicit rollback, and a reader-first runbook. Hub-enabled
activation composes the existing owner-only Node fleet registry, exact service and
runtime-config hashes, fresh identity-bound Node health, and the verified Hub capability
endpoint. Planning and apply both re-observe the exact inventory; incomplete, stale,
changed, unverified, or incapable membership fails before coordinate mutation.

## FH1: Causal work envelope

Implement `work.causality.recorded` on every existing managed path.

Deliverables:

- pure work and ancestry invariants;
- root creation at managed request admission;
- retry, repair, subagent, verification, publication, deliberation, and improvement
  child relationships;
- immutable parent validation and idempotent append;
- projection of historical runs as `legacy_unlinked`; and
- contract tests shared by root agents and subagents.

Acceptance requires every managed golden journey to have exactly one root, every new run
to have exactly one valid causal event before provider start, no child to escape its work
tree, and no new source of objective, assignment, or completion authority.

Implementation state on 2026-09-01: FH1 is implemented. Pure execution-contract
invariants validate roots, every declared child relationship, retry ordinals, immutable
parents, same-work membership, cycles, conflicts, idempotent crash recovery, and
`legacy_unlinked` historical projection. Managed admission writes causality and
`run.requested` atomically before provider start and fails closed on a version-1 writer.
SQLite independently enforces one causal event per run and one root per work. CLI,
remote host, and conversation paths create roots; deliberation creates one control root
with all provider and publication-evaluation runs as children. Shared root/subagent and
Codex/Claude golden tests prove provider-neutral behavior.

## FH2: Resource ledger and work report

Implement the resource contract for current Codex and Claude adapters and current
provider-backed query/evaluation paths.

Deliverables:

- accounting descriptor and resource event schemas;
- adapter declarations and common counter-normalization tests;
- cumulative deduplication, delta idempotency, and contradiction handling;
- `WorkExecutionReportV1` pure projector;
- `lervo trace --work <work-id> [--json]` and the equivalent Hub projection; and
- explicit direct-terminal whole-task unavailability with separate observed projection
  usage.

Acceptance requires each managed golden journey to be complete or carry an exact typed
reason, repeated or streaming cumulative observations not to double count, CLI and Hub
to produce the same semantic report, and no report to label provider-reported usage as
billed cost. Cross-provider totals remain separated.

Implementation state on 2026-09-01: FH2 is implemented. Codex and Claude declare
turn-cumulative accounting descriptors; the shared accumulator handles cumulative,
delta, regression, arithmetic, and contradiction semantics; managed completion records
one final resource observation after persisting the descriptor. The new pure
`@lervo/execution-observability` projector backs local `trace --work` and the bounded Hub
work route. Direct terminal coverage keeps whole-task usage unavailable and reports
query-projection receipt usage separately. Missing FH3 stage observations remain typed
and keep the aggregate report partial rather than fabricating completion.

## FH3: Stage timing and hook performance

Instrument before optimizing.

Deliverables:

- monotonic bounded stage-set recording for managed runs and terminal hooks;
- small, medium, large, cold, warm, and concurrent environment profiles;
- a reproducible benchmark harness that reports population, p50, p95, eligible p99,
  maximum, failure rate, CPU, memory, and instrumentation overhead;
- stage-specific diagnosis of knowledge-query and lifecycle hook latency; and
- bounded optimizations with paired retrieval-quality and correctness checks.

Initial direct-hook budgets are:

- no valid observation reaches the 30-second external ceiling;
- prompt-preparation p95 is at most 15 seconds;
- prompt-preparation p99 is at most 24 seconds only when population is at least 100;
- Stop p95 is at most 5 seconds; and
- no reviewed profile regresses by more than 10 percent without an accepted exception.

Deterministic provider-free paths use at least 100 repetitions. Live-provider paths use
at least 30 and publish p50, p95, and maximum; p99 remains unavailable below 100. Budget
changes require environment evidence, not a slower timeout. An optimization fails if it
improves latency while violating retrieval, exact-load, privacy, or lifecycle contracts.

Implementation state on 2026-09-01: FH3 is implemented. Managed and direct terminal
paths emit bounded monotonic stage sets through version 2 writers and retain typed
absence for version 1 or failed direct observations. Work trace and terminal coverage
use shared pure projections. The provider-free benchmark verifies six cold, warm,
small, medium, large, Stop, and concurrent profiles with 100 alternating pairs, exact
environment and source digests, resource distributions, stage diagnosis, signed
instrumentation overhead, and paired retrieval, lifecycle, and privacy checks. The
checked evidence and strict budgets are recorded in
[foundation execution performance evidence](../../evidence/foundation/execution-performance-v1.md).

## FH4: Adverse-condition proof

Prove current effects safe before a loop can repeat them.

Deliverables:

- an effect inventory with retry, cancellation, uncertainty, compensation, and recovery
  meaning for each state-changing boundary;
- fault injection around provider admission, event/CAS append, managed writes,
  assignments, leases, workspaces, terminal persistence, capabilities, sync, and external
  effects;
- deterministic duplicate, stale retry, cancellation, lease expiry, fan-out, join,
  backpressure, and queue-bound tests;
- integrated repository/provider/extension/Hub threat model and telemetry privacy audit;
- small, medium, large, and concurrent capacity profiles with retention or compaction for
  every growing collection; and
- upgrade, failed-upgrade, rollback, migration-idempotence, and drift rehearsals.

Each injected crash must end as exact completion, exact rollback, or
`recovery_required`. Unknown external effects require reconciliation and cannot be
retried as if absent. Third-party code remains disabled until an out-of-process,
revocable, resource-bounded isolation boundary and conformance suite pass.

Implementation state on 2026-09-01: FH4 is implemented. A provider-neutral effect
contract and reviewed inventory cover 13 current state-changing categories. The checked
adverse-condition report binds 65 deterministic recovery projections, focused runtime
suite hashes, all current top-level event allowlist fields, an integrated 15-case threat
model, 17 growing-collection policies, four capacity profiles, and upgrade, failed-
upgrade, rollback, migration-idempotence, state-recovery, and retrieval-drift rehearsals.
Provider start, stream, and stop uncertainty is no longer marked retryable. Workforce
capacity has one owner and pure bounded cancellation propagates through existing
assignment dependencies without creating execution-graph authority. Arbitrary third-
party execution and unattended scheduling remain disabled.

## FH5: Foundation readiness

Compose the implementation evidence without replacing its constituent checks.

Planned aggregate command:

```text
pnpm foundation:check
  -> foundation:contracts:check
  -> foundation:replay:check
  -> foundation:performance:check
  -> foundation:recovery:check
  -> foundation:security:check
```

The implementation creates
`docs/evidence/foundation/foundation-readiness-v1.md` with exact contract versions,
fixture and suite hashes, environments, measurements, telemetry completeness, injected
failures, recovery outcomes, unsupported states, capacity bounds, security findings,
upgrade and rollback results, and release-completion evidence.

Implementation state on 2026-09-01: the aggregate readiness contract, independent
focused checks, clean-clone local-without-Hub journey, distribution checks, source and
suite bindings, and three-observation report verifier are implemented. Acceptance awaits
the checked three-observation evidence generated from committed implementation bytes.

Acceptance requires local operation without Hub, packed-CLI and fresh-clone journeys,
Codex and Claude managed golden journeys, compatible Node/Hub sync, and reviewed writer
activation recovery. Three consecutive complete foundation observations must remain
inside the accepted budgets; repeated success does not waive any missing gate.

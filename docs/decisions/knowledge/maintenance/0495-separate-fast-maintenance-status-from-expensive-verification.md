# ADR-0495: Separate fast maintenance status from expensive verification

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md), [ADR-0486](../semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)
Related: [ADR-0491](../semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md), [ADR-0493](0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0494](0494-recover-missing-document-evidence-before-requesting-owner-input.md)

## Context

One read-only Mac measurement on October 8 took 22.147 seconds for convergence status, compared with 0.558 seconds for owner status and 0.591 seconds for freshness status. This is a diagnostic sample, not a benchmark distribution. Source inspection explains why: CLI `status` and `inspect` both call complete baseline discovery, capture sources, inspect normalization/currency, and replay historical evidence. The in-memory discovery reuse from ADR-0486 does not survive a new CLI process or independently provide a cheap status path.

Normalization batch selection also rebuilds preflight while reducing the document prefix. Timeout-driven batch halving lives only in an obligation and resets with a new baseline. Generation and independent review have different costs: a batch that fits generation call ceilings may still be too large to review within its deadline. Increasing timers, call concurrency, or token budgets does not address these repeated costs.

## Decision proposal

### Serve observations without rerunning maintenance

Make `lervo knowledge convergence status` read the latest bounded observation, current process health, source-change hints, and the local owner fence. It makes no provider call, Hub round trip, full repository scan, or history replay. With absent or invalid observations, return `unknown` coverage and the observed reason promptly; do not rebuild synchronously or invent zero debt.

Retain `inspect` as the explicit authoritative scan and verification request. It supports a bounded deadline, cancellation, phase timing, and partial coverage. Its structured output names coverage and reason for unfinished phases. Inspection never silently upgrades a stale observation to current, and a timeout never reports a clean repository.

Preserve current status fields when their evidence exists. Add observation revision, age, source of observation (`local`, `owner`, or `unknown`), owner generation, event cursor, and coverage per queue. The new versioned JSON contract makes `baselineCurrent` nullable: only exact present verification can produce true, observed unresolved debt produces false, and unverified state produces null. A persisted verified snapshot is verified as of its observation time. Without an exact current source identity, metadata status returns null even when change hints are quiet. Hints may invalidate an observation; they cannot establish currency.

Keep the legacy JSON shape during the declared compatibility window, mapping unknown currency conservatively to false and including the new coverage reason. Activate the nullable contract only through an explicit schema-version negotiation or documented CLI version transition after consumer fixtures pass. New readers must not infer known staleness from a legacy false or current currency from cached true.

Show local history separately from an optional owner observation. A follower's historical `knowledge_cancelled` event cannot be rendered as the current owner's failure. Owner summaries bind repository identity, generation, source digest, and observed time. Optional Hub exchange improves visibility but local inspection and local execution remain complete without it.

### Reuse exact repository observations across stages and processes

Extend ADR-0486's repository/event split into a bounded, reconstructible observation store. Share prepared scan, normalization inspection, candidate listing, and currency inputs within one snapshot. A changed repository fence, materialization event, policy, roles, normalization record, delegation, or evaluation contract invalidates the relevant component. Ordinary assignment events advance only event-derived state.

Use an anchored `(seq, eventHash)` cursor and paged typed reads for the event tail. Anchor mismatch or store replacement schedules full replay. Status reads never replay the full log. A change index may accelerate subtree/dependency lookup, but an uncertain watcher signal falls back to authoritative bounded recapture. Watcher hints and filesystem metadata never authorize apply.

Keep one current observation per repository, at most 1 MiB of summary/receipt references, with component data in bounded CAS/storage projections. No one-file-per-cycle directory. Before writes, re-read and hash the exact approval-bound inputs under exclusive admission regardless of a cache hit. Reference inspection and full currency verification retain their fail-closed contracts.

### Plan batches once and retain measured cost learning

Calculate document byte/unit/envelope costs from one prepared normalization inspection. Select a stable, fair subset that fits generation calls, expected review input/output, elapsed budget, and independent reviewer capacity. An oversized document cannot consume the byte allowance and exclude every later small document. Report it separately and resume an exact bounded source-unit workset.

Record a bounded controller keyed by provider descriptor/model, compiler contract, review contract, and source-size class. Retain at most 64 entries. Start conservatively; lower byte/unit ceilings after a review timeout and raise them only after at least three successful comparable reviews, within existing delegation ceilings. Preserve cost learning across unrelated HEAD changes and obligation replacement. Changed contracts start a new key.

Persist generated envelopes and independently reviewed document subsets by complete content/policy/context digest. Reuse validated exact artifacts; never reuse an expired authority or incomplete review. Timeout of a compound review subdivides it without regenerating unchanged approved content. Required source-unit coverage stays complete, and one source's subset approvals do not approve another source. Interrupted or uncertain calls reconcile their durable effect keys before retrying.

### Attribute delay and define performance acceptance

Measure `capture`, `history_tail`, `evidence`, `generation`, `review`, `apply`, `verification`, `publication`, and waiting reasons independently. Status time, queue age, provider wall time, and Lervo CPU time are separate metrics. Freshness budgets and cross-check ceilings remain unchanged. Every recovery and fallback counts against its existing budget; unknown usage is never zero.

Benchmark identical baseline/candidate snapshots, Git history, event population, artifact cache state, and delegation. Run five unmeasured warmups followed by 100 alternating pairs for metadata status; run at least 30 pairs for full inspection on the reference repository. Report p50/p95, eligible p99, maximum, CPU, peak RSS, bytes read, scan count, and failures. Retain the existing unstable-environment rejection rather than selecting favorable runs.

Proposed gates:

- Warm metadata status p95 at most 1 second; cold metadata status p95 at most 2 seconds, including cache-missing unknown output.
- Unchanged event-only progress performs zero full repository recaptures; cached and uncached snapshots are byte-equivalent.
- Reference-repository full inspection p95 at most 30 seconds and at least 50 percent less Lervo CPU than the paired task-base build. Both conditions apply.
- Median and p95 time to independently reviewed settlement improve by at least 50 percent for the same finite backlog, model descriptor, and spend ceiling. No claim if provider variance makes the comparison unstable.
- A seven-day installed run meets ADR-0493's eligible-work latency targets while preserving foreground response performance and existing host CPU limits.

These are implementation targets, not results of the single diagnostic timing.

## State, events, privacy, and failure meaning

`MaintenanceObservationV1` requires `projectId`, `repositoryDigest`, `evaluationContractHash`, `ownerGeneration` or null, `observedAt`, `verifiedAt` or null, `eventCursor`, queue coverage/counts, and evidence receipt hashes. Observation states are `verified`, `changed`, `stale`, `partial`, and `unknown`; health has its independent existing state. Cache absence/corruption yields `maintenance_observation_unavailable`, never authority failure.

Public output excludes source bytes, paths, credentials, host addresses, and provider text. Private work detail may name repository-relative paths under existing access controls. Optional exchanged summaries contain hashes, counts, queue identifiers, closed reasons, and times only. Source/dependency indexes are not canonical knowledge.

Use existing stage-observation events for timings after compatible reader support. Register any new stage names and closed reason fields in the telemetry schema before activation. Do not append an event for every status request or cache hit. Controller records replace prior values; corruption resets planning conservatively.

`maintenance_inspection_deadline` means incomplete authoritative inspection with recorded coverage. `maintenance_observation_anchor_invalid` schedules bounded replay. `maintenance_batch_unreviewable` means subdivide without weakening review. None suppresses a warning, grants spend, or establishes currency.

## Verification and rollout

Test cold/missing/corrupt observations, same-size file changes, restored timestamps, untracked/deleted files, index-only changes, materialization, event-anchor mismatch, follower observations, generation changes, and no-Hub fallback. Compare cached/full digests and inject a stale approval at apply; it must fail.

Test fairness when a large document precedes small ones, retained adaptive limits after source churn, exact artifact reuse, compiler/model changes, timeout subdivision, crash recovery, and partial review coverage. Run the paired benchmark and prove installed acceptance; documentation and heartbeat alone cannot earn completion. See the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

## First delivery boundary

The [source implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and remaining protocol work. This proposal's full acceptance gates are not implied by those source changes. Installed writer activation, fleet recovery, and the seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

The first delivery's CLI status surface is version 2 (`kind: knowledge_maintenance.status`). Its observation member is a bounded version-1 as-of summary with owner generation, capture age, historical verification time, and `unknown | observed | stale` coverage. It deliberately has no repository digest or event cursor and is never reused for currency or effects. Missing counts are null and the conservative legacy `baselineCurrent` field is false. `inspect` preserves full verification for clients requiring the previous status semantics. Anchored component caches and partial authoritative inspection require a subsequent contract and remain unimplemented by this summary record.

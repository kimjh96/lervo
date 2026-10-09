# ADR-0495: Separate fast maintenance status from expensive verification

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md), [ADR-0486](../semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)
Related: [ADR-0491](../semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md), [ADR-0493](0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0494](0494-recover-missing-document-evidence-before-requesting-owner-input.md)

## Context

A read-only Mac measurement during the October 8 pre-delivery investigation took 22.147 seconds for convergence status, 0.558 seconds for owner status, and 0.591 seconds for freshness status. This was a diagnostic sample, not a benchmark distribution. At that snapshot, CLI `status` and `inspect` both performed complete baseline discovery, source capture, normalization/currency inspection, and historical evidence replay. ADR-0486's in-memory discovery reuse neither survived a new CLI process nor independently provided cheap status.

Normalization batch selection also rebuilt preflight while reducing the document prefix. Timeout-driven batch halving lived only in an obligation and reset with a new baseline. Generation and independent review have different costs: a batch within generation call ceilings may exceed its review deadline. Increasing timers, call concurrency, or token budgets does not remove these repeated costs.

## Decision proposal

### Serve observations without rerunning maintenance

Make `lervo knowledge convergence status` read the latest bounded observation, current process health, source-change hints, and local owner fence. It makes no provider call, Hub round trip, full repository scan, or history replay. Missing or invalid observations promptly return `unknown` coverage and the observed reason; never rebuild synchronously or invent zero debt.

Retain `inspect` as the explicit authoritative scan and verification request, supporting a bounded deadline, cancellation, phase timing, and partial coverage. Structured output names coverage and reasons for unfinished phases. Inspection never silently promotes a stale observation to current; a timeout never reports a clean repository.

Preserve existing status fields where evidence exists. Add observation revision, age, source (`local`, `owner`, or `unknown`), owner generation, event cursor, and per-queue coverage. In the new versioned JSON contract, `baselineCurrent` is nullable: exact present verification alone permits true; observed unresolved debt yields false; unverified state yields null. Persisted verified snapshots are verified only as of their observation time. Without an exact current source identity, metadata status returns null even when change hints are quiet. Hints can invalidate observations but cannot establish currency.

During the declared compatibility window, retain the legacy JSON shape, conservatively mapping unknown currency to false and including the new coverage reason. Activate the nullable contract only through explicit schema-version negotiation or a documented CLI version transition after consumer fixtures pass. New readers must infer neither known staleness from legacy false nor current currency from cached true.

Separate local history from optional owner observations. A follower's historical `knowledge_cancelled` event must not appear as the current owner's failure. Owner summaries bind repository identity, generation, source digest, and observed time. Optional Hub exchange improves visibility; local inspection and execution remain complete without it.

### Reuse exact repository observations across stages and processes

Extend ADR-0486's repository/event split into a bounded, reconstructible observation store. Within one snapshot, share prepared scan, normalization inspection, candidate listing, and currency inputs. A changed repository fence, materialization event, policy, roles, normalization record, delegation, or evaluation contract invalidates the relevant component. Ordinary assignment events advance only event-derived state.

Use an anchored `(seq, eventHash)` cursor and paged typed event-tail reads. Anchor mismatch or store replacement schedules full replay; status reads never replay the full log. A change index may accelerate subtree/dependency lookup, but uncertain watcher signals fall back to authoritative bounded recapture. Watcher hints and filesystem metadata never authorize apply.

Keep one current observation per repository, with at most 1 MiB of summary/receipt references and component data in bounded CAS/storage projections. Do not create one file per cycle. Before writes, re-read and hash exact approval-bound inputs under exclusive admission, regardless of cache hits. Reference inspection and full currency verification retain their fail-closed contracts.

### Plan batches once and retain measured cost learning

Calculate document byte/unit/envelope costs from one prepared normalization inspection. Select a stable, fair subset within generation calls, expected review input/output, elapsed budget, and independent reviewer capacity. An oversized document must not consume the byte allowance and exclude every later small document. Report it separately and resume an exact bounded source-unit workset.

Persist a bounded controller keyed by provider descriptor/model, compiler contract, review contract, and source-size class, retaining at most 64 entries. Start conservatively. Lower byte/unit ceilings after review timeout; raise them only after at least three successful comparable reviews, within existing delegation ceilings. Preserve cost learning across unrelated HEAD changes and obligation replacement. Changed contracts start a new key.

Persist generated envelopes and independently reviewed document subsets by complete content/policy/context digest. Reuse validated exact artifacts, never expired authority or incomplete review. Subdivide a timed-out compound review without regenerating unchanged approved content. Required source-unit coverage remains complete; one source's subset approvals never approve another source. Interrupted or uncertain calls reconcile durable effect keys before retrying.

### Attribute delay and define performance acceptance

Measure `capture`, `history_tail`, `evidence`, `generation`, `review`, `apply`, `verification`, `publication`, and waiting reasons independently. Separate status time, queue age, provider wall time, and Lervo CPU time. Freshness budgets and cross-check ceilings remain unchanged. Every recovery and fallback counts against its existing budget; unknown usage is never zero.

Benchmark identical baseline/candidate snapshots, Git history, event population, artifact cache state, and delegation. For metadata status, run five unmeasured warmups followed by 100 alternating pairs. For full inspection, run at least 30 pairs on the reference repository. Report p50/p95, eligible p99, maximum, CPU, peak RSS, bytes read, scan count, and failures. Retain existing unstable-environment rejection; do not select favorable runs.

Proposed gates:

- Warm metadata status p95 is at most 1 second; cold metadata status p95 is at most 2 seconds, including cache-missing unknown output.
- Unchanged event-only progress performs zero full repository recaptures; cached and uncached snapshots are byte-equivalent.
- Reference-repository full inspection p95 is at most 30 seconds, with at least 50 percent less Lervo CPU than the paired task-base build. Both conditions apply.
- Median and p95 time to independently reviewed settlement improve by at least 50 percent for the same finite backlog, model descriptor, and spend ceiling. Make no claim if provider variance makes comparison unstable.
- A seven-day installed run meets ADR-0493's eligible-work latency targets while preserving foreground response performance and existing host CPU limits.

These are implementation targets, not results of the single diagnostic timing.

## State, events, privacy, and failure meaning

`MaintenanceObservationV1` requires `projectId`, `repositoryDigest`, `evaluationContractHash`, `ownerGeneration` or null, `observedAt`, `verifiedAt` or null, `eventCursor`, queue coverage/counts, and evidence receipt hashes. Observation states are `verified`, `changed`, `stale`, `partial`, and `unknown`; health retains its independent existing state. Cache absence/corruption yields `maintenance_observation_unavailable`, never authority failure.

Public output excludes source bytes, paths, credentials, host addresses, and provider text. Private work detail may name repository-relative paths under existing access controls. Optional exchanged summaries contain only hashes, counts, queue identifiers, closed reasons, and times. Source/dependency indexes are not canonical knowledge.

Use existing stage-observation events for timings after compatible reader support. Register new stage names and closed reason fields in the telemetry schema before activation. Never append an event for every status request or cache hit. Controller records replace prior values; corruption resets planning conservatively.

- `maintenance_inspection_deadline`: authoritative inspection is incomplete, with coverage recorded.
- `maintenance_observation_anchor_invalid`: schedule bounded replay.
- `maintenance_batch_unreviewable`: subdivide without weakening review.

None suppresses a warning, grants spend, or establishes currency.

## Verification and rollout

Test cold/missing/corrupt observations, same-size file changes, restored timestamps, untracked/deleted files, index-only changes, materialization, event-anchor mismatch, follower observations, generation changes, and no-Hub fallback. Compare cached/full digests. Injecting a stale approval at apply must fail.

Test fairness when a large document precedes small ones, retained adaptive limits after source churn, exact artifact reuse, compiler/model changes, timeout subdivision, crash recovery, and partial review coverage. Run the paired benchmark and prove installed acceptance; documentation and heartbeat alone cannot earn completion. See the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

## First delivery boundary

The [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and installed reader deployment. Schema-5 writer activation completed for Lervo checkouts on Mac and WSL; other repositories retain their selected writer versions. This scoped activation establishes neither a schema-5 freshness assessment receipt, complete evidence recovery, fleet recovery, nor document currency. Full protocol acceptance and seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

The first delivery's CLI status surface is version 2 (`kind: knowledge_maintenance.status`). Its observation member is a bounded version-1 as-of summary with owner generation, capture age, historical verification time, and `unknown | observed | stale` coverage. It has no repository digest or event cursor and is never reused for currency or effects. Missing counts are null; conservative legacy `baselineCurrent` is false. `inspect` preserves full verification for clients needing previous status semantics. Anchored component caches and partial authoritative inspection require a subsequent contract and remain unimplemented by this summary record.

Implementation evidence reports fast metadata reads on the observed Mac installation with warm OS caches. These measurements establish neither authoritative-inspection performance, paired CPU reduction, nor faster independently reviewed settlement. The paired benchmarks and seven-day acceptance remain required.

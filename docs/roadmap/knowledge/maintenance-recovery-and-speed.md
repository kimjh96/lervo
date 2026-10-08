# Knowledge maintenance recovery and speed

Status: `in_progress`
As of: 2026-10-08
Scope: first source implementation delivered; complete protocol and installed acceptance pending

## Outcome and decisions

Make automatic maintenance advance despite unrelated queued work, recover missing evidence without a user bookkeeping command, and return useful status promptly. Currency remains an evidence claim; health, queue drainage, and zero lint errors cannot substitute for it.

The [investigation](../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) reproduced directory evidence loss and measured one 22.147-second local convergence status read. Proposed decisions are [ADR-0493 scheduling and safe effects](../../decisions/knowledge/maintenance/0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0494 evidence recovery](../../decisions/knowledge/maintenance/0494-recover-missing-document-evidence-before-requesting-owner-input.md), and [ADR-0495 observations and processing cost](../../decisions/knowledge/maintenance/0495-separate-fast-maintenance-status-from-expensive-verification.md). The first implementation follows their bounded preparation, evidence, and observation boundaries; the complete scheduling and incremental-inspection proposals remain open.

This work extends [autonomous background convergence](autonomous-background-convergence.md) and [document freshness](../../specifications/knowledge/document-freshness.md). It does not widen principal authority or establish fleet deployment.

## Responsibility and dependency boundaries

| Boundary                                               | Responsibility and intended changes                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lervo/repository-knowledge`                          | Typed evidence/assessment contracts, dependency-bound admission and supersession, no-change witness evaluation, deterministic queue policy. Pure decisions have no Git, filesystem, Hub, or provider imports; dedicated receipt and working-state adapters retain the existing package I/O boundary. |
| `@lervo/repository-knowledge-runtime` evidence adapter | Git object resolution, directory-child selection and bounded paging, evidence preflight and recoverable receipts. Split collection from policy evaluation rather than expanding the current helper indefinitely.                                                                                     |
| Runtime maintenance scheduler                          | Queue eligibility, fairness, wake times, and one-call quantum. Worker remains composition; separate preparation, durable continuation, and consequential-effect admission.                                                                                                                           |
| Runtime apply/integration                              | Existing owner fence, source journal, scoped leases, independent review, commit selection, and post-commit rebind. Read-set validation precedes every effect.                                                                                                                                        |
| Runtime observation and batch planner                  | Bounded observation store, exact component invalidation, event-tail cursors, single preflight, persistent cost controller. Metadata status and authoritative inspection remain separate entrypoints.                                                                                                 |
| Storage, event, and CLI contracts                      | Versioned readers, event registry, projection limits, explicit unknown coverage, compatibility fixtures, and phase timings. CLI composes services without owning policy.                                                                                                                             |

Before source edits, resolve canonical instructions and inspect each target's responsibility and dependency boundary. Apply the code-convention module-split signals and review checklist to every changed source. Retain common Codex/Claude contracts and local operation without a Hub.

## First source delivery

Implemented bounded file/tree evidence and preflight, exact legacy-empty-candidate recovery, independently reviewed no-change receipts, dependency and dirty-source invalidation, reader-first event schema 5, metadata-only status, resident provider quanta, single normalization preflight, byte packing, exact review continuation, and retained timeout learning. See the [implementation evidence](../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) for checks and limits.

The resident reserves a preparation turn after two convergence turns. This counter is a bounded initial scheduler, not proof of the proposed eligible-provider-turn latency gate. Existing repository and host cycle locks remain around each bounded turn; apply retains the parked-convergence gate. Complete directory-page assessments, uncertain freshness-call reconciliation, exclusive apply/rebind crash proof, anchored incremental inspection, phase-wide metrics, and Mac/WSL rollout remain bounded next scopes.

## Delivery order

### 1. Reader compatibility and attributable observations

Register proposed event fields and closed failure codes, add readers and schema fixtures, and define legacy candidate/projection migration. Record capture, history, evidence, generation, review, apply, verification, and wait durations independently. Capture paired task-base benchmark inputs before changing performance behavior.

Implement metadata status with missing/corrupt observation coverage explicitly unknown. This read-only improvement can ship before scheduler effects. Readers precede producers; old CLI consumers must retain documented semantics during the compatibility window. Require an explicit versioned activation plan and rollback fixtures before writing new events.

### 2. Evidence recovery and detector settlement

Fix file/tree resolution and bounded directory evidence. Add deterministic preflight before provider generation and technical recovery distinct from owner authority. Reclassify only legacy candidates with an evidenced technical failure; preserve owner rejection and exact held patches.

Bind supersession and no-change assessment to document, dependency, reference, policy, and verification hashes. The detector consumes only valid current witnesses. Run the two installed empty candidates through recovery after local fixtures and common adapters pass. No global reclassification or warning suppression is permitted.

### 3. Fair preparation and safe effects

Introduce independent ready queues and bounded scheduling quanta. Separate snapshot capture from provider work, preserve current admission/spend ceilings, and persist exact resumable receipts. Reserve eligible freshness preparation after at most two other provider turns; measure excluded time explicitly.

Keep the old effect gate until the exclusive apply boundary, interrupted-journal recovery, exact read-set revalidation, and unfinished-batch checkpoint/rebind protocol pass crash and concurrent-write tests. Start with freshness observation/evidence preparation during queued normalization; enable overlapping candidate generation and effects only as their prerequisites pass.

### 4. Incremental inspection and review-aware batching

Share one prepared observation within a snapshot and persist bounded reconstructible components across processes. Validate event anchors and dependency invalidation. Use explicit deadlines and partial coverage for authoritative inspection. Cached/full outputs must be equivalent before reuse reaches write preparation.

Build normalization preflight once. Select by byte, unit, call, review-output, and elapsed capacity with fair handling of oversized documents. Preserve measured cost limits across obligations and reuse only exact independently verified artifacts. A review timeout subdivides unchanged envelopes while uncertain calls reconcile before retry.

### 5. Installed verification and release

Record reviewed release intent for CLI or bundled-private changes. Run source quality, relevant contract/lifecycle tests, release completion against the implementation task base, and migration followed by lint. Install compatible reader builds before activating writers on Mac and WSL. Preserve owner fencing and the existing public/private release workflow.

Run a seven-day installed canary with ongoing developer commits, foreground activity, ownership turnover, and no-Hub fallback. Store exact versions, source/contract hashes, spend/usage evidence, exclusions, and latency distributions. Do not check completion from documentation, heartbeat, a single fast command, or a terminal Stop.

## Acceptance gates

Source verification for the first delivery is recorded in the [implementation evidence](../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md). Grouped gates remain unchecked where installed, crash, performance, or full protocol evidence is still missing.

- [ ] Compatible event/state readers pass old/new and rollback fixtures before writer activation.
- [ ] Small and oversized directory changes, renames, deletion, shallow history, unusual path bytes, and sensitive exclusions produce exact bounded evidence or a named recoverable failure. Empty coverage makes zero generation calls.
- [ ] The two installed evidence-empty candidates recover without owner bookkeeping. Genuine ambiguity and verified owner-held patches retain their authority.
- [ ] Valid no-change witnesses settle only the matching stale finding; dependency edits restore it. Normalization mismatch and broken links remain visible until independently resolved.
- [ ] Continual normalization enqueueing cannot starve eligible freshness preparation. One blocked item cannot monopolize other queues, and known budget resets wake without a repository edit.
- [ ] Owner loss, source conflicts, dirty developer targets, and crashes around journal/apply/event/commit/rebind produce at most one effect and no stale review reuse.
- [ ] Status makes no provider call, Hub round trip, full scan, or history replay. Warm p95 is at most 1 second and cold p95 at most 2 seconds, including unknown output, in the declared paired benchmark.
- [ ] Event-only progress performs zero full recaptures. Cached/full digests match for same-size edits, restored timestamps, untracked/deleted files, index changes, event replacement, and policy/role/materialization changes.
- [ ] Full inspection p95 is at most 30 seconds and Lervo CPU is at least 50 percent lower than the paired task-base build. Timeouts expose partial coverage.
- [ ] Review-aware batches retain cost learning across source churn, do not starve small documents, and resume exact verified subsets after timeout without weakening coverage.
- [ ] Median and p95 independently reviewed settlement time improve at least 50 percent for the same finite backlog, descriptor, and spend ceiling; unstable provider comparisons cannot earn this gate.
- [ ] Over seven installed days, eligible safety/entrypoint findings start evidence preparation within 10 minutes at p95 and at least 90 percent of eligible in-scope non-owner-held work settles within 24 hours. Report wall and excluded time, foreground impact, and host resource limits.
- [ ] Relevant common provider, lifecycle, quality, migration/lint, and release-completion checks pass with exact installed version evidence. Native provider journeys are recorded individually.

## Risks and fallback

The main safety risk is changing canonical bytes while another batch holds an approval over them. Keep the existing effect gate until the replacement protocol is proven. The main reporting risk is presenting an old cached observation as current. Return explicit age/coverage and require authoritative revalidation for effects. The main cost risk is unbounded evidence paging or retries; enforce per-work limits, exact attempt keys, budget accounting, and bounded projections.

Rollout can stop new preparation and return to existing scheduling while retaining canonical events and receipts. Rollback must never discard started journals or treat a new unknown schema as successful settlement. No fallback may suppress findings, increase authority, or reset uncertain effects.

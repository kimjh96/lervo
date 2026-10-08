# ADR-0493: Schedule knowledge maintenance by ready work and safe effects

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0465](../documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Related: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0494](0494-recover-missing-document-evidence-before-requesting-owner-input.md), [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md)

## Context

The [October 8 investigation](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) found a healthy WSL owner with 74 normalization documents pending at `normalization_review`. The freshness stage had not completed since October 6. The current worker runs freshness only when convergence is `idle`, `current`, `waiting_authority`, or `attention_required`. A queued normalization stage therefore blocks even unrelated freshness observation and candidate preparation.

The worker also holds the repository worker lock while processing change intake, up to eight convergence stages, and freshness. Generation can take up to 25 minutes for a normalization batch. Host admission yields between stages, but a stage can contain several long calls. These are source-level scheduling risks; the investigation did not measure their complete installed latency distribution.

Removing the freshness gate alone would violate the batch-boundary HEAD fence. A freshness commit could invalidate a generated normalization candidate before independent review or apply. The remedy must separate preparation from consequential effects.

## Decision proposal

### Schedule bounded work across independent queues

Use queues for change intake, canonicalization, normalization, document freshness, and lifecycle reconciliation. A queue is a scheduling view over canonical jobs, candidates, receipts, and repository evidence. It is not a second authority or a new append-only history.

Each ready item records its first eligible time, dependency digest, next wake time, and remaining authorized budget. Reserve one freshness preparation turn after at most two other provider turns when freshness is eligible. Rotate the other queues by oldest eligible time. Within freshness retain safety and entrypoint priority, with aging for other documents. A held item consumes no execution turn and cannot block another queue.

The guarantee is conditional on provider availability, host admission, live foreground work, and reviewed budget. Excluded time is measured under a named reason. Internal queueing and a long background call are measured delay, not exclusions. Repeated reservations cannot manufacture eligibility or increase existing spend ceilings. Budget exhaustion schedules the known reset, instead of silently waiting for a source edit.

A scheduling quantum contains one provider call or at most 30 seconds of deterministic work. A long call has a deadline and remains non-preemptive until it returns or is cancelled safely. The scheduler releases admission after that quantum; it cannot hold a repository or host capture lock across a model call. Generation envelopes and independent review fragments resume from exact durable receipts.

Dispatch observation and deterministic evidence preparation while a provider call is in flight when capture admission is available. Do not make that work await the provider promise. Before admitting another call, compare its deadline with the oldest eligible reservation; split or defer work that would overrun it. Existing ten-minute generation calls cannot earn the latency gate solely by counting completed turns.

### Prepare without writing canonical bytes

Acquire capture admission to bind an immutable source snapshot, policy, roles, delegation, verification contract, and owner generation. Release it before generation. Use existing content-addressed artifacts and isolated workspace contracts; providers cannot write the root checkout.

Freshness detection and evidence preparation may run while normalization is queued. Candidate generation and independent review use the existing provider adapter and shared admission limits. The current limit of two host background calls and the current per-repository call exclusion remain ceilings, not performance tuning knobs.

Prepared work records a read set, a proposed write set, and exact content hashes. A changed unrelated file permits revalidation of the same read set; changed source, context, role, policy, or verification input invalidates only the affected work. HEAD equality alone is insufficient to reuse approval. A carried review requires a receipt proving that every approval-bound input remained identical.

### Apply only through an explicit safe boundary

The single cross-host owner reacquires exclusive source/write admission. The following must all hold:

- The owner lease, delegation, scoped assignment, path-conflict checks, and authority remain current.
- No live or interrupted materialization journal owns the repository, and no overlapping reader or writer lease is active.
- Proposed target bytes match the candidate's pre-image; uncommitted developer work wins.
- All read-set hashes and independent verification still match. Disjoint write sets alone do not prove independence.
- The scheduler has reconciled the current convergence stage and its pending receipts.

At an existing batch boundary, commit settled normalization outputs and eligible freshness outputs through the existing durable transaction and commit-selection contract. Record each effect separately; a commit-only receipt never impersonates review or apply. Continue with the observed post-commit snapshot.

If a freshness patch must land before an unfinished normalization batch, checkpoint that batch before any effect and prove its read set disjoint from the patch. After the freshness commit, bind a new source snapshot and reuse only exact unchanged generation/review inputs. An overlapping batch is regenerated with prior review revoked. Unknown or started effects require journal recovery; they cannot be reset or guessed complete.

This protocol is a prerequisite to removing the current state gate. The gate stays until crash, concurrent-write, and post-commit tests prove the replacement.

### Detect lack of progress separately from process health

Report queue age, last successful work time, next attempt, and reason independently from heartbeat. A process can be healthy while maintenance is delayed. After two eligible scheduling turns without progress, record a repairable attention item and run bounded deterministic recovery. After exhausted recovery, surface the specific technical blocker; do not ask the owner to approve a nonexistent patch.

No-change assessments settle only their exact document and dependency witness under ADR-0494. Historical, policy-excluded, genuinely owner-held, and technically blocked work remain separate. Neither a drained queue nor zero lint errors proves repository currency.

## State, events, privacy, and failure meaning

The proposed `MaintenanceWorkV1` scheduling projection records `workKey`, `queue`, `dependencyDigest`, `state`, `firstEligibleAt`, `lastProgressAt`, `nextAttemptAt`, `attempts`, `reasonCode`, `ownerGeneration`, and receipt references. States are `ready`, `preparing`, `prepared`, `applying`, `waiting_dependency`, `waiting_authority`, `repairing`, `blocked`, and `settled`. State describes one work item; existing convergence states retain their meaning.

Retain at most 512 active items per repository. Overflow reports `maintenance_queue_capacity` and leaves canonical work discoverable. Use one replaceable, owner-only projection; recover from events and artifacts. Cross-host observation is optional and never transfers authority.

Add event schema support for `knowledge.maintenance.progress` before enabling writers. Required fields are `projectId`, `workKey`, `queue`, `fromState`, `toState`, `dependencyDigest`, `ownerGeneration`, `reasonCode` or null, `receiptHashes`, and `occurredAt`. Append on state transitions, never heartbeat or status reads. Event fields contain identifiers, hashes, counts, times, and closed codes; no paths, contents, prompts, credentials, or provider error text. Receipt bodies remain private CAS material.

`maintenance_dependency_changed` means recapture affected work. `maintenance_effect_busy` means retry without writes. `maintenance_effect_uncertain` requires existing journal reconciliation. `maintenance_progress_stalled` means eligible work failed to advance and recovery owns the next step. None grants approval or marks currency current.

## Verification and delivery

Implementation must preserve local operation without a Hub and common Codex/Claude contracts. Test continual normalization enqueueing, budget reset without edits, foreground interruption, admission turnover, owner death, source change, and same-file conflicts. Freshness must receive its reserved eligible turn and a blocked item must not monopolize another queue.

Crash every transition before and after journal write, apply, event append, commit, and post-commit rebind. Prove one effect, recoverable pre-images, unchanged user work, and no reuse of stale review. Test the protocol against ADR-0465's committed-head fence rather than replacing it with a weaker check.

Installed acceptance requires a seven-day Mac/WSL run under ongoing developer commits. Eligible safety/entrypoint findings must start evidence preparation within 10 minutes at p95. Report wall time and excluded time separately. At least 90 percent of eligible, in-scope, non-owner-held work must reach verified settlement within 24 hours. These are targets, not current measurements.

The [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md) orders reader compatibility, evidence repair, safe scheduling, performance, and installed proof. No deployment or authority widening occurs through accepting this document alone.

## First delivery boundary

The [source implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and remaining protocol work. This proposal's full acceptance gates are not implied by those source changes. Installed writer activation, fleet recovery, and the seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

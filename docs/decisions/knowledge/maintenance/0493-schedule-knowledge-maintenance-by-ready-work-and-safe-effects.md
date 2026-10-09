# ADR-0493: Schedule knowledge maintenance by ready work and safe effects

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0465](../documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Related: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0494](0494-recover-missing-document-evidence-before-requesting-owner-input.md), [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md)

## Context

The [October 8 investigation](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) found a healthy WSL owner with 74 normalization documents pending at `normalization_review`; freshness had not completed since October 6. At that pre-delivery snapshot, freshness ran only when convergence was `idle`, `current`, `waiting_authority`, or `attention_required`. Queued normalization therefore blocked unrelated freshness observation and candidate preparation.

The worker held the repository worker lock through change intake, up to eight convergence stages, and freshness. Normalization batch generation could take 25 minutes. Host admission yielded between stages, but each stage could contain several long calls. These were source-level scheduling risks; the investigation did not measure their complete installed latency distribution.

Removing the freshness gate alone would violate the batch-boundary HEAD fence: a freshness commit could invalidate a generated normalization candidate before independent review or apply. Preparation must be separated from consequential effects.

## Decision proposal

### Schedule bounded work across independent queues

Use queues for change intake, canonicalization, normalization, document freshness, and lifecycle reconciliation. Each queue is a scheduling view over canonical jobs, candidates, receipts, and repository evidence, not a second authority or new append-only history.

Each ready item records its first eligible time, dependency digest, next wake time, and remaining authorized budget. Reserve one freshness preparation turn after at most two other provider turns when freshness is eligible. Rotate other queues by oldest eligible time. Within freshness, retain safety and entrypoint priority while aging other documents. Held items consume no execution turn and cannot block another queue.

This guarantee depends on provider availability, host admission, live foreground work, and reviewed budget. Measure excluded time under a named reason. Internal queueing and long background calls count as delay, not exclusions. Repeated reservations cannot manufacture eligibility or increase existing spend ceilings. Budget exhaustion schedules the known reset rather than waiting silently for a source edit.

A scheduling quantum contains one provider call or at most 30 seconds of deterministic work. A long call has a deadline and remains non-preemptive until it returns or is safely cancelled. Release admission after each quantum; never hold a repository or host capture lock across a model call. Generation envelopes and independent review fragments resume from exact durable receipts.

While a provider call is in flight, dispatch observation and deterministic evidence preparation when capture admission is available; do not await the provider promise. Before admitting another call, compare its deadline with the oldest eligible reservation and split or defer work that would overrun it. Existing ten-minute generation calls cannot earn the latency gate solely by counting completed turns.

### Prepare without writing canonical bytes

Acquire capture admission to bind an immutable source snapshot, policy, roles, delegation, verification contract, and owner generation. Release it before generation. Use existing content-addressed artifacts and isolated workspace contracts; providers cannot write the root checkout.

Freshness detection and evidence preparation may run while normalization is queued. Candidate generation and independent review use the existing provider adapter and shared admission limits. The limits of two host background calls and per-repository call exclusion remain ceilings, not performance tuning knobs.

Prepared work records a read set, proposed write set, and exact content hashes. An unrelated file change permits revalidation of the same read set; changed source, context, role, policy, or verification input invalidates only affected work. HEAD equality alone cannot justify approval reuse. Carrying review requires a receipt proving every approval-bound input remained identical.

### Apply only through an explicit safe boundary

The single cross-host owner reacquires exclusive source/write admission. All of these conditions must hold:

- Owner lease, delegation, scoped assignment, path-conflict checks, and authority remain current.
- No live or interrupted materialization journal owns the repository, and no overlapping reader or writer lease is active.
- Proposed target bytes match the candidate's pre-image; uncommitted developer work wins.
- All read-set hashes and independent verification still match. Disjoint write sets alone do not prove independence.
- The scheduler has reconciled the current convergence stage and pending receipts.

At an existing batch boundary, commit settled normalization outputs and eligible freshness outputs through the existing durable transaction and commit-selection contract. Record each effect separately: a commit-only receipt never impersonates review or apply. Continue with the observed post-commit snapshot.

If a freshness patch must land before an unfinished normalization batch, checkpoint that batch before any effect and prove its read set disjoint from the patch. After the freshness commit, bind a new source snapshot and reuse only exact unchanged generation/review inputs. Regenerate overlapping batches and revoke prior review. Unknown or started effects require journal recovery; never reset them or guess completion.

This protocol must precede removal of the current state gate. Retain the gate until crash, concurrent-write, and post-commit tests prove its replacement.

### Detect lack of progress separately from process health

Report queue age, last successful work time, next attempt, and reason independently from heartbeat: a healthy process can have delayed maintenance. After two eligible scheduling turns without progress, record a repairable attention item and run bounded deterministic recovery. Once recovery is exhausted, surface the specific technical blocker; do not ask the owner to approve a nonexistent patch.

No-change assessments settle only their exact document and dependency witness under ADR-0494. Keep historical, policy-excluded, genuinely owner-held, and technically blocked work separate. Neither a drained queue nor zero lint errors proves repository currency.

## State, events, privacy, and failure meaning

The proposed `MaintenanceWorkV1` scheduling projection records `workKey`, `queue`, `dependencyDigest`, `state`, `firstEligibleAt`, `lastProgressAt`, `nextAttemptAt`, `attempts`, `reasonCode`, `ownerGeneration`, and receipt references. States are `ready`, `preparing`, `prepared`, `applying`, `waiting_dependency`, `waiting_authority`, `repairing`, `blocked`, and `settled`. Each state describes one work item; existing convergence states retain their meaning.

Retain at most 512 active items per repository. Overflow reports `maintenance_queue_capacity` and leaves canonical work discoverable. Use one replaceable, owner-only projection, recoverable from events and artifacts. Cross-host observation is optional and never transfers authority.

Add schema support for `knowledge.maintenance.progress` before enabling writers. Required fields are `projectId`, `workKey`, `queue`, `fromState`, `toState`, `dependencyDigest`, `ownerGeneration`, `reasonCode` or null, `receiptHashes`, and `occurredAt`. Append only on state transitions, never heartbeat or status reads. Fields contain identifiers, hashes, counts, times, and closed codes; exclude paths, contents, prompts, credentials, and provider error text. Receipt bodies remain private CAS material.

Failure meanings:

- `maintenance_dependency_changed`: recapture affected work.
- `maintenance_effect_busy`: retry without writes.
- `maintenance_effect_uncertain`: reconcile through the existing journal.
- `maintenance_progress_stalled`: eligible work failed to advance; recovery owns the next step.

None grants approval or marks currency current.

## Verification and delivery

Preserve local operation without a Hub and common Codex/Claude contracts. Test continual normalization enqueueing, budget reset without edits, foreground interruption, admission turnover, owner death, source change, and same-file conflicts. Freshness must receive its reserved eligible turn; blocked items must not monopolize another queue.

Crash every transition before and after journal write, apply, event append, commit, and post-commit rebind. Prove one effect, recoverable pre-images, unchanged user work, and no stale-review reuse. Test against ADR-0465's committed-head fence; do not replace it with a weaker check.

Installed acceptance requires a seven-day Mac/WSL run under ongoing developer commits. Eligible safety/entrypoint findings must start evidence preparation within 10 minutes at p95. Report wall time and excluded time separately. At least 90 percent of eligible, in-scope, non-owner-held work must reach verified settlement within 24 hours. These are targets, not current measurements.

The [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md) orders reader compatibility, evidence repair, safe scheduling, performance, and installed proof. Accepting this document alone causes no deployment or authority widening.

## First delivery boundary

The [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and installed reader deployment. Schema-5 writer activation completed for Lervo checkouts on Mac and WSL; other repositories retain their selected writer versions. This scoped activation establishes neither a schema-5 freshness assessment receipt nor complete evidence recovery, fleet recovery, or document currency. Full protocol acceptance and the seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

The first delivery reserves preparation after two convergence turns but retains repository and host cycle locks around each bounded turn and the parked-convergence effect gate. Releasing capture locks before provider execution and proving exclusive apply, journal recovery, checkpoint, and rebind remain required. Installed activation does not earn those scheduling or effect-safety gates.

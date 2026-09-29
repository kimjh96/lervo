# Background knowledge convergence audit

Status: `observed`
As of: 2026-09-27

## Scope and method

Read-only inspection covered the seven repositories on the configured always-on host. Normalization lifecycle was inspected at 09:41 UTC; event/outbox snapshots at 09:48 UTC; currency and candidate registries at 09:49 UTC. Each event/outbox query used one SQLite read transaction and retained the observed head. These are point-in-time observations, not a fleet-wide atomic snapshot or proof of complete event-chain integrity.

Source review used revision `b3798091d8d49c3c331e25b1f440e4150adc6e93`; the installed r141 Node contains the background candidate generator. No project documents, provider settings, service state, or messages were changed during host diagnosis.

## Installed observations

| Repository | Pending normalization / eligible | Change jobs / resolutions | Resolution states             | Outstanding queue | Observed event head |
| ---------- | -------------------------------- | ------------------------- | ----------------------------- | ----------------: | ------------------: |
| Lervo      | 186 / 1,157                      | 0 / 0                     | None observed                 |                 0 |              28,336 |
| AXLI       | 13 / 14                          | 35 / 35                   | 35 attention                  |                 0 |              22,141 |
| Arca-next  | 72 / 486                         | 3 / 3                     | 2 pending review, 1 attention |                 0 |              15,524 |
| Plen       | 0 / 75                           | 0 / 0                     | None observed                 |                 0 |               3,306 |
| Shiflo     | 20 / 183                         | 0 / 0                     | None observed                 |                 0 |               7,867 |
| Flemo      | 20 / 54                          | 0 / 0                     | None observed                 |                 0 |               3,994 |
| Digimon    | 0 / 30                           | 0 / 0                     | None observed                 |                 0 |                 877 |

Of 311 pending documents, 242 appear in stale normalization output families; 69 have no current valid normalization record. Stale family counts do not alone identify which output byte caused the family to stale.

All seven read-only currency inspections returned `current: false` with `knowledge_migration_pending` and `instruction_bridge_pending`. The five repositories with document debt also returned `normalization_pending`. No result reported `knowledge_lint_invalid`; valid lint is therefore insufficient evidence of full lifecycle currency. Additional Plen and Digimon plans were ready to update four structural projection records, with ready bridge plans and zero lint issues. Their bridge target before/after hashes were identical: the bridge plan was pending because it includes those structural dependencies, not because the bridge document needed rewriting. No repair was applied.

The sampled change events all had a resolution or queue entry. No acknowledged entry without a resolution was observed. This verifies the inspected event/outbox coverage only: it cannot establish that every historical repository change was captured. No `current` generic knowledge resolution was observed in this fleet snapshot.

AXLI's 35 attention outcomes comprise 34 `review_source_encoding_unsupported` and one `review_needs_attention`. The latest three encoding failures, events 20,920, 20,950, and 21,009, contain two Python `__pycache__` files in their four-path manifests. Current cache bytes fail UTF-8 decoding. The sample demonstrates that cache paths can enter text review; it does not establish every earlier failure's exact bytes or authorize an extension-based exclusion.

Arca-next event 11,870 references candidate `kcanon_1260f32ba5d0cfd824e337d2`, now observed rejected. Event 12,083 records `pending_review/canonical_change_candidate` with a null candidate ID. Event 12,360 records `attention_required/before_bytes_unavailable`. All three queue entries have been consumed. A later rejection does not rewrite a historical pending-review outcome, and there is no separately observed convergence receipt closing these obligations.

Current candidate registries show seven rejected Lervo candidates, one rejected Arca-next candidate, and six stale Flemo candidates. Other repositories returned no candidate records. These counts are distinct from normalization debt and historical job outcomes.

Stored normalization candidate files were recently modified for AXLI at 09:35 UTC and Arca-next at 09:29 UTC. Both latest files have Codex compiler provenance. Presence and modification time prove storage only, not successful review, application, or generation by a particular running process. Kael's separately observed Claude weekly limit is not evidence that these Codex candidates were blocked by that limit.

## Source-backed findings

| Finding                                           | Current source boundary                                                                                                  | Consequence                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Generation depends on a conversation              | `NormalizationCandidatePreparer.review()` calls `generate()` only when no reviewable candidate exists                    | No startup/timer independently drains normalization baseline debt.                                                          |
| Review depends on later agent work                | Conversation knowledge assignments and normalization procedure inject review/apply into a write-capable turn             | A stored candidate can remain unapplied indefinitely.                                                                       |
| No autonomous lifecycle repair                    | Worker host calls read-only `inspectRepositoryKnowledgeCurrency()`                                                       | Implementation-only review with lifecycle debt settles attention instead of migration/bridge/refresh continuation.          |
| Null canonical candidate is permitted             | `pendingReview()` uses `assessment.candidate?.candidateId ?? null`                                                       | Semantic candidate verdict can consume its queue row with no assigned candidate.                                            |
| No post-review source fence                       | Generic worker checks after-bytes before `host.review()`, then settles without rereading them                            | Concurrent source edits can invalidate the semantic review before `current`.                                                |
| Context and history are weaker in the active host | Host reads only root AGENTS, slices at 64 KiB, and asks for classification only; former bytes search HEAD through HEAD~3 | Applicable nested instructions, exact canonical context, meaningful rationale, and older pinned history are not guaranteed. |
| Baseline/capacity recovery is incomplete          | Generic source appends an event without queueing when capacity is full; active worker only claims existing queue entries | Old unqueued events and repositories with debt but no new changes lack an autonomous continuation in this path.             |

The richer dormant conversation source/context/lease modules provide existing boundaries to reuse. Their presence does not prove the active generic worker enforces them. Source findings are implementation gaps; this audit does not claim a production false-current event was observed.

## Reproduction and tests

Two probes ran in private temporary repositories against built modules, with isolated event stores and a fake review host. Each store and repository was removed afterward.

1. The fake reviewer changed a newly created text source before returning `implementation_only`; a fake lifecycle inspection returned current. The worker nevertheless recorded `current` and consumed the queue. This isolates the missing post-review source check, not the validity of a real lifecycle inspection.
2. A newly created canonical specification received `canonical_change_candidate`. Typed canonical assessment returned no noncanonical source candidate; the worker recorded `pending_review` with null candidate ID and consumed the queue. This reproduces the installed outcome shape.

Five existing focused suites passed 15 tests: repository change source, generic worker, canonicalization candidate, conversation assignment, and normalization preparer. The common no-capability process-compiler suite passed 11 tests across Codex and Claude. These tests establish existing adapter and basic lifecycle behavior; they do not cover autonomous review/integration, idle convergence, the reproduced review-time drift, or production false-current recovery.

## Conclusion and next contract

The design turn generated one bounded normalization candidate for its two new detailed specifications, compared all six outputs against the exact original sources, and applied both items with their exact approvals. Candidate `knorm_0f75fdea235bac34ca3c2647` used one provider call with 20,633 observed total tokens and retained the design's responsibilities, states, required fields, limits, links, and recovery conditions. This is local design-document lifecycle work, not cleanup of the installed fleet's backlog or activation of the proposed runtime.

Atomic source-job and outcome-acknowledgement foundations work in the sampled records, but canonicalization, normalization, and lifecycle verification do not form a continuously owned completion path. Empty queues and healthy transports must not be reported as knowledge convergence. The proposed [background design](../../specs/background-knowledge-convergence.md) and [delivery gates](../../roadmap/knowledge/autonomous-background-convergence.md) address these gaps. This remains the pre-implementation audit at its recorded base. The [implementation evidence](background-knowledge-convergence-implementation.md) records subsequent local repairs and private installed acceptance; production fleet debt was not drained by that canary.

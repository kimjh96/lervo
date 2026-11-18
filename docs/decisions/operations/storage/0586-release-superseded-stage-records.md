# ADR-0586: Release superseded stage records

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md) (records that root settled inputs), [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md) (reference roots and candidates)

## Context

[ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md) stopped `assignment.created` from rooting settled stage inputs, but it released almost nothing on the Mac. Retained stage results, failure proofs and provider stage observations still named those inputs. ADR-0585 left those records to a separate decision.

A read-only estimate on 2026-11-18 measured that decision on the Mac. Stage results were most of the protected bytes. On 2026-11-18 the owner approved these rules:

1. A convergence stage result protects its objects only while its obligation is open, or while it belongs to the latest settled stage of that obligation. Older stage results of settled obligations stop protecting objects.
2. Provider observations and failure proofs that belong only to superseded stages of settled obligations also stop protecting objects.
3. Live workforce records still protect everything they name. The ADR-0585 roots, the link from each input to its previous input, the 14-day grace period, the event-head and inventory fences, the per-cycle cap and the fail-closed reads all stay.

## Decision

### Superseded stages

A convergence assignment is one whose `assignment.created` event carries `convergenceObligationId` and a valid `convergenceInputArtifactHash` (ADR-0585). Its stage is superseded when all of the following hold:

- Its obligation has a `repository.knowledge.convergence.recorded` event.
- The assignment was created before that settlement.
- The obligation's last stage record whose state is neither `queued` nor `running` names a different `assignmentId`.
- That record does not name the assignment's input.

The terminal stage's input is that last record's result, so the terminal stage is never superseded. An assignment of an open obligation is never superseded.

### Records that stop protecting

A record is released only when its body proves that it belongs to a superseded stage. The collector reads the body, checks it against its digest and parses it as JSON. It then requires these fields:

| Record                     | How it is found                                                                                                                                                                                                       | Required fields                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage result               | The superseded assignment's `assignment.completed` names it, and no other assignment's completion does.                                                                                                               | No `kind`. `assignmentId` equals that assignment. `state` is a string, `leaseGeneration` is a `sha256:` digest, `nextStage` is a string or null, `failureCode` and `dependencyHash` exist, and `input.obligationId` equals the assignment's obligation. |
| Failure proof              | As for a stage result.                                                                                                                                                                                                | `kind: "convergence_assignment_failure"`, `schemaVersion: 1`, a string `code`, `assignmentId` equal to that assignment, and `inputArtifactHash` equal to its input.                                                                                     |
| Provider stage observation | Nothing names an observation. The collector probes every object of at most 1 MiB that is past grace and is not a candidate. `canonicalJson` sorts keys, so an observation starts with `{"admissionObservationHash":`. | `kind: "provider_stage_observation"`, `schemaVersion: 1`, `assignmentId` naming a superseded assignment, and `inputArtifactHash` equal to that assignment's input.                                                                                      |

Every other object stays protected. That includes a body that is unparseable, fails its digest, lacks a field, names another assignment, obligation or input, or is larger than 32 MiB. A hash that two assignments' completions name is ambiguous and also stays.

A released record becomes collectable, and the objects it names become edges instead of roots. The events whose `payload.assignmentId` is its own assignment no longer root it. Neither does that assignment's archive. Any other record that names it still roots it, including a live workforce record, another assignment's event and an effect checkpoint. Its grace period runs from its own modification time and from the latest of its assignment's own events that names it. Both must be older than 14 days.

An eligible record whose assignment is no longer superseded when a later cycle replays the log roots itself and everything it names. A pass therefore never deletes a record on the strength of an older replay.

### What does not change

- A live workforce record roots everything it names. Settled assignments are archived only when they are terminal and hold no lease.
- Each current `normalization_apply` and `canonical_integration` stage still roots its payload permanently.
- Every input keeps the hash of its previous input in its receipts. That link stays a reference.
- The 14-day grace period, the event-head and inventory fences before each unlink, the 32-object cap per cycle, the 24-hour wait between passes and the fail-closed reads of ADR-0534 and ADR-0584 stay.

### Classification state

The collector must know which records are released before a pass fixes its eligible set. It classifies the candidate bodies at the start of each pass, within the same per-cycle read budget as the reference scan. When the budget runs out, the cycle saves its progress and the pass starts in a later cycle.

The scan projection gains one optional field, `records`. It maps a bare digest to one of three values. The first is a shape with three required fields:

- `kind`: `stage_result`, `observation` or `failure`;
- `assignmentId`: the `assignmentId` in the body;
- `binding`: a stage result's `input.obligationId`, or an observation's or failure's `inputArtifactHash`.

The second, `null`, means the whole body was read and is not a releasable record, so the object stays protected. The third, `no_observation_prefix`, means only the first bytes were read and they do not start an observation. A completion that later names that object still reads its whole body, so an assignment that becomes superseded after a probe is still classified. A CAS object never changes its bytes, so each entry stays valid while its object exists. Entries survive the end of a pass and are dropped when their object is gone. The field holds digests and opaque identifiers only, never a path or body. It shares the projection's 32 MiB bound and checksum. An invalid projection, including an invalid `records` entry, starts a fresh scan. A read failure other than a vanished or replaced file stops the cycle as `unavailable` with `failed`, and nothing is deleted.

### Readers of a pruned record

A new reader state, `result_unavailable`, describes an assignment's own result record that is absent. It is returned by `readConvergenceAssignmentResult`, beside `available` and `invalid`. Reports render it as "result unavailable (pruned)".

- It has no fields beyond the state name.
- It carries no path, hash or body and grants no authority.
- It is not an integrity failure. The caller proves nothing from the record.
- `invalid` keeps its meaning: a digest or parse mismatch, or the persistent CAS failures `corrupt_object`, `invalid_uri` and `unsafe_path`.
- A transient read failure, such as `EIO`, `EMFILE` or a lock, still throws, so no caller records it as a state.

Each of these readers surfaced a raw `not_found` store error before this change:

- Completed-assignment reuse in `workforce.ts` now raises `knowledge_effect_uncertain`. The owner records `recovery_required`, so the existing uncertain-effect inspection decides the stage instead of an unclassified failure.
- `retryConvergenceAssignment` now raises `knowledge_effect_uncertain`. A failed attempt without its proof cannot show what it did.
- `inspectRetainedCanonicalIntegration` now raises `knowledge_effect_uncertain`, as `workforce.ts` does. Without the writer result, an integration that already landed cannot be told from divergence. Returning null would let a capacity-blocked batch park without retiring that effect, and `preflightCanonicalTargets` could then read the landed drafts as divergence. A digest mismatch is also `knowledge_effect_uncertain`.
- Settled-stall evidence in `host.ts` skips the retained-integration inspection, so the stall stays in place.

All four read records that a live workforce record or an open obligation still roots. They meet `result_unavailable` only after a loss outside this policy. A source audit of production `artifacts.get` calls found no archive reader or audit that opens a stage result, failure proof or observation body. Status, inspection, audit and `find-replay` read none of them.

A completed assignment's identity is derived from its stage input, so `workforce.ts` cannot claim it again to rerun the stage. A writer stage could also repeat its effect. Workforce reuse, retry and integration recovery therefore stop as uncertain instead of rerunning.

### Read-only plan

`lervo state cas-retention --plan` stays read-only. It classifies records with the same rules, without a read budget, and reports three more reasons under `collectable.byReason`. Each reason has `objects` and `bytes`:

- `stage_result_superseded`: superseded stage results, and candidates that only they still kept;
- `failure_superseded`: superseded failure proofs, and candidates that only failures and observations kept;
- `observation_superseded`: superseded observations, and candidates that only observations kept.

A released record counts under its own reason. A candidate that only released records kept counts under the first reason, in the order above, that releases it. The ADR-0585 reasons keep their meaning: they count candidates that the ADR-0585 policy already releases. `candidates` now includes released records past grace. Like the collector's sweep, the plan counts an object as collectable only when the latest record naming it, by either rule, is past grace. The plan still names no path, hash or body.

## Consequences

On 2026-11-18, a read-only Node replay applied these rules to the Mac `lervo` and `argo` repositories. It read each live event log, CAS object and reference file. It opened the event log with `readOnly`, and other SQLite files `immutable` unless they had a live WAL. It wrote nothing.

| Repository | CAS              | ADR-0585 policy | Stage results    | Failures and observations | All rules        |
| ---------- | ---------------- | --------------- | ---------------- | ------------------------- | ---------------- |
| lervo      | 9,418 / 7.28 GB  | 78 / 252.9 MB   | 462 / 1,869.4 MB | 440 / 32.8 MB             | 980 / 2,155.0 MB |
| argo       | 15,527 / 0.94 GB | 143 / 1.3 MB    | 699 / 197.0 MB   | 608 / 5.0 MB              | 1,450 / 203.3 MB |

On lervo, the stage-result rule releases 459 stage results and three candidates that only they named. The other rule releases 432 observations and 8 failure proofs. On argo, they release 699 stage results, then 593 observations, 14 failure proofs and one input.

An earlier estimate by another agent classified records by body shape alone and counted 611 argo objects for the second rule. The implemented rule also requires an observation to name its assignment's input. Three argo observations name a different input, so they stay protected.

The figures assume one completed pass and ignore the cap. Releasing 980 lervo objects takes at least 31 sweeping cycles. Before its first pass, the lervo collector also reads about 2.6 GB of superseded completion bodies, at most 64 MiB per cycle. It probes up to 9,400 small objects, at most 1,024 per cycle. The cached shapes make later passes read only new objects. The WSL figures remain unknown.

### Follow-ups

These levers were measured and deferred. Each needs its own owner decision.

1. Archive the terminal live workforce records of settled obligations. Those records keep their stage results and inputs. Live records of superseded stages remain: on lervo, 162 completed, 4 failed and 1 queued; on argo, 64 completed and 6 leased.
2. Stop the link from each input to its previous input from rooting superseded inputs. With the rules above in place, this would release a further 187 lervo objects (689.3 MB) and 348 argo objects (75.5 MB). It changes what a receipt chain can prove, so it needs a reader audit first.
3. Investigate the stale leases. Seven lervo records hold a lease on the latest stage of an obligation that has already settled. On argo, six records on superseded stages and two on latest stages do the same. A leased record cannot be archived, so it keeps its references indefinitely.

## Verification

Tests and builds were not run on the Mac, and WSL was not accessed. GitHub CI runs typecheck, lint and tests. These new tests fail before this change:

- a superseded stage result and the candidate that only it named are collected, while the latest settled stage's result and an open obligation's result remain;
- superseded failure proofs and observations are collected, while the latest stage's records and an observation of another input remain;
- unparseable, unknown, mismatched and ambiguous bodies remain;
- the readers report `result_unavailable`, a pruned or invalid writer result stops integration recovery as `knowledge_effect_uncertain`, a pruned failure proof stops a retry as `knowledge_effect_uncertain`, and a transient read failure still throws;
- the plan reports `stage_result_superseded`, `failure_superseded` and `observation_superseded` separately and deletes nothing.

The read-only replay above was rerun with the implemented classification. It reproduced the lervo figures of the earlier estimate exactly. No live store was written.

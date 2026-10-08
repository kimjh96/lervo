# Knowledge maintenance recovery and speed investigation

Status: `design-reviewed`
Observed on: 2026-10-08
Task base: `d66c98274a8302e0e857b1c4fe860c9dcebc48c0`

This investigation supports three proposed decisions: [fair scheduling and safe effects](../../decisions/knowledge/maintenance/0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [evidence recovery and assessment settlement](../../decisions/knowledge/maintenance/0494-recover-missing-document-evidence-before-requesting-owner-input.md), and [bounded status and processing cost](../../decisions/knowledge/maintenance/0495-separate-fast-maintenance-status-from-expensive-verification.md). The [delivery plan](../../roadmap/knowledge/maintenance-recovery-and-speed.md) defines implementation and installed acceptance. No runtime fix or deployment is established by this document.

## Installed observations

The environment target was refreshed through `lervo environment query` before remote reads. WSL had a live owner lease at generation 1 and a healthy running worker. Its convergence snapshot was `queued` at `normalization_review`, with canonicalization debt 0, normalization debt 74, lifecycle debt 3, historical debt 0, and one outstanding assignment. Process health therefore did not establish progress or currency.

The last recorded WSL freshness cycle was `2026-10-06T06:55:40.276Z`. Its candidate state counts were 9 verified, 2 waiting for authority, and 3 rejected. The recent apply list was empty; verified candidates do not prove nine applied patches. The last observed resident cycle processed at `2026-10-08T00:07:40.762Z`. These are point-in-time observations, not a measured duration of every stalled stage.

The two waiting candidates were:

| Candidate                         | Document                                                           | Created at                 |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| `kfresh_73cd716ad064fc1cc4afbfdd` | ADR-0242, refine search rollout decision route                     | `2026-10-05T07:16:22.953Z` |
| `kfresh_a3aa09a4b35093561f3a1ec8` | ADR-0458, learn from single observations and run standing autonomy | `2026-10-06T00:05:12.781Z` |

Both had `operation: needs_owner_input`, `state: waiting_authority`, zero evidence items, truncated evidence, no hunks, no output hash, and no apply command. Their explanations identified missing changed-path diffs and excerpts. Neither was a concrete patch an owner could approve. The evidence gap is distinct from genuine user-owned content or policy authority.

Local lint after the earlier push returned valid with zero errors and 116 warnings: 54 document-stale, 34 normalization-stale, 17 source-unit-stale, one materialization-stale, and ten missing Markdown link targets. Staleness coverage was 154 evaluated documents out of 1,611: 100 current, 54 stale, and 1,457 unevaluated. Lint categories and convergence queue counts have different scopes; they must not be added together or interpreted as complete currency coverage.

The Mac follower retained a historical `knowledge_cancelled` attention record while waiting for the WSL owner. That history did not prove a current WSL cancellation. Status must distinguish local history, live owner state, observation age, and coverage.

## Evidence-builder reproduction

The current `packages/repository-knowledge-runtime/src/freshness-evidence-bundle.ts` was transpiled using the workspace TypeScript compiler and run against a temporary Git repository. Its source SHA-256 was `e07beda5d408918a122895cf6647a766a18a39451d71e25e87cd615515c1a8a4`. Imports used the local domain package build. The fixture committed a guide connected to `src/` and a text file beneath it, then changed that file. It made no provider calls and changed no project source bytes. The temporary repository was removed afterward.

| Connected path and change                 | Evidence items | Truncated | Diff bytes | Excerpt lines |
| ----------------------------------------- | -------------: | --------- | ---------: | ------------: |
| Directory `src/`, one changed line        |              0 | false     |        175 |             0 |
| Directory `src/`, 1,500 changed lines     |              0 | true      |     absent |             0 |
| File `src/facts.txt`, 1,501 changed lines |              1 | true      |     absent |            40 |

The helper requests a blob at `HEAD:<connected-path>`. A directory is a tree, so no file bytes are returned. Evidence-item admission requires file bytes. A small diff therefore still yields no citeable items; an oversized directory diff also loses the excerpt fallback. The regular-file control demonstrates that the excerpt fallback works when blob resolution succeeds. This reproduces the helper defect; it does not independently replay every input of the installed candidates.

The correction must enumerate relevant changed children, bind tree and blob identities, preserve omitted coverage, and stop before generation when evidence is insufficient. Merely setting a nonzero evidence count or increasing the diff limit would not establish claim support.

## Timing and source review

One sequential local sample used Python's monotonic clock around installed JSON CLI commands:

| Command                                           |      Wall time |
| ------------------------------------------------- | -------------: |
| `lervo knowledge convergence owner status --json` |  0.558 seconds |
| `lervo knowledge freshness status --json`         |  0.591 seconds |
| `lervo knowledge convergence status --json`       | 22.147 seconds |

This is a diagnostic sample, not p95, a cold-cache benchmark, or an installed improvement claim. WSL status also took substantially longer than a metadata read, but no precise remote latency benchmark was retained. No provider generation or review timings were benchmarked.

Source review established the following mechanisms:

| Finding                                                                                         | Source responsibility                          | Consequence                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Freshness runs only in parked convergence states.                                               | Runtime worker and freshness convergence gate  | Continual queued normalization can postpone unrelated freshness work.                    |
| Open freshness candidates exclude the same document from admission.                             | Domain freshness priority                      | Evidence-empty owner waits have no automatic recovery path.                              |
| Supersession checks document bytes rather than all dependencies.                                | Runtime freshness stage                        | Source changes can leave a held or settled assessment bound to old evidence.             |
| No-change verification does not advance the detector's verified revision.                       | Domain candidate and staleness evaluation      | A settled assessment and a remaining stale warning can disagree.                         |
| Status and inspect both discover a complete baseline.                                           | Runtime status and baseline                    | A user status read repeats capture, normalization/currency inspection, and history work. |
| Discovery reuse is process-local.                                                               | Runtime discovery cache                        | A new CLI process cannot reuse the resident's prepared observation.                      |
| Batch prefix reduction rebuilds preflight; large sources consume allowance before smaller ones. | Runtime normalization generation and selection | Repeated deterministic work and avoidable batch exclusion.                               |
| Review timeout halves a batch inside the current obligation.                                    | Runtime normalization review                   | Source churn discards learned review limits and can repeat expensive generation.         |

The worker's broad lock and multistage turn amplify the scheduling risk. Existing admission already limits host and repository calls and yields between stages. The design retains those limits and shortens each admitted quantum; increasing concurrency without attribution would worsen contention or spend.

## Alternatives and design review

| Option                                                                              | Review result                                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Poll more often or raise tokens/call concurrency                                    | Does not change eligibility, missing evidence, or repeated full scans. Retain existing ceilings.                                    |
| Remove the freshness state gate immediately                                         | Can invalidate unfinished normalization reviews through a HEAD-changing commit. Requires the explicit prepare/apply protocol first. |
| Approve or regenerate empty candidates manually                                     | Offers no exact effect to approve and repeats the same evidence defect. Recover technical dependencies automatically.               |
| Suppress warnings or mark documents historical                                      | Changes reported truth without a witness. Reject.                                                                                   |
| Independent ready queues, technical recovery, bounded observations, and exact reuse | Addresses each demonstrated cause while retaining authority, journal, review, privacy, and no-Hub contracts. Selected proposal.     |

Review preserved provider-neutral domain contracts, adapter-owned I/O, current cross-host ownership, user bytes, source hashes, independent verification, and budget ceilings. Prepared work may overlap observation, but apply requires exclusive admission and exact current read sets. A disjoint output path alone cannot authorize reuse of a review. Cache hits and heartbeat never establish repository currency.

The proposed state/event names, required fields, privacy rules, failure meanings, and reader-before-writer rollout are in the three ADRs. Planned gates include evidence recovery without owner bookkeeping, warning settlement through exact assessments, foreground-safe fairness, status latency, CPU reduction, crash recovery, and a seven-day installed Mac/WSL run. All runtime gates remain unobserved until implementation.

## Limits and remaining evidence

The investigation does not establish the complete stage latency distribution, provider cost attribution, native Claude success, full coverage of installed producers, or the end-to-end migration behavior of legacy candidates. Paired benchmarks and installed journeys must supply those results. The proposed latency and settlement percentages are acceptance targets, not achieved speedups.

The base repository already had warnings and incomplete installed acceptance. Design documents do not remove those findings. A future implementation must record reviewed CLI/bundled-private release intent, run the repository completion checks, activate compatible readers before writers, and provide exact installation evidence separately.

## Design artifact validation

Documentation lifecycle checks passed for 532 documents. Source quality, formatter ownership, structural-review registry, script architecture, and brand checks passed. All changed-document relative links resolved. Release completion against the task base returned `not_required` for ten documentation/taxonomy paths; no runtime source or CLI behavior changed.

`lervo migrate knowledge --json` produced a ready structural plan with zero blockers; its 1,701 proposed operations were not applied during this design task. The subsequent knowledge lint returned valid with zero errors and 123 warnings: 54 document-stale, 37 normalization-stale, 21 source-unit-stale, one materialization-stale, and ten missing links. Compared with the earlier 116-warning observation, the design edits added three normalization and four source-unit findings. Neither a migration plan nor valid lint establishes settled or installed maintenance.

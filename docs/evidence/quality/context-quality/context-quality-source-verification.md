# Context quality source verification

Status: `source_subset_verified; inactive_writer_controlled_cohort_qualified; fleet_not_deployed`
As of: 2026-10-09

This evidence covers the [outcome and event rollout source slice](../../../specifications/execution/context-quality/outcome-and-event-rollout.md), following owner work items 1–5. It does not complete ADR-0501 or owner items 6–9 as a whole. The task base is `53eec5565af89eae2a18acd2d39cd99d78358a61`.

## Current consolidated review

Review begins from candidate `3a1d7a7b9042126ae2cfa4cc53f6dfc7ee7f093e` against main `8cb3e0a759a7f6dd1b55204ba26b4348ebeea943`. The initial inventory contained 495 changed paths, including 225 production and repository-script files. The current pass covers 70 files: the 29 changed repository-context modules, three verification modules, two writing modules, 20 context modules and 16 schema/compiler modules. The remaining 155 source/script files, configuration, evidence collections and full privacy review are still open. Partial inspection of dependencies does not count as their completed review.

These owners separate source preparation, bounded admission, exact artifact evaluation, task-verifier response validation, scoped language policy and effect-owner correction. The repository-context facade exposes existing operations and types. Preparation and commit queues retain bounded transient work; correction retains at most three candidate observations and awaits an invoked write before reporting its outcome. Quality events contain bounded metadata, while complete reports use existing private content-addressed storage. This review does not infer provider delivery or use from preparation or recording.

The review reproduced a task-verification defect. If a caller changed `artifactDigest` or `planDigest` while the evaluator was pending, the accepted checks described the original request but the final `evaluationDigest` used the changed input. Both new regression cases failed before the fix. The verifier now derives that digest from its existing private request, which is also used to validate the evaluator's response. The response schema, caller-owned evaluator admission and correction authority stay unchanged.

The next pass reproduced four failures in instruction supersession: an inactive, unresolved or conflicting intermediate rule could suppress an otherwise applicable rule, including when the intermediate rule had a missing reference. Resolution now traverses only eligible replacements and fixes their membership before applying exclusions. Applicable transitive chains and cycle detection remain independent of input order. A repository preparation regression verifies that an out-of-scope intermediate rule leaves the complete original clause and its exception in prepared context. The local preparation build advances to version 2 so its bindings distinguish the correction.

Both fixes stay within their existing pure validation owners. They add no dependency, export, persistent state or schema. Context discovery, applicability, packing, evidence selection and observation retain separate responsibilities. Schema definitions, catalog registration, build-time compilation, artifact generation and runtime validation also remain separate; the existing catalog registration module needs no review-hash refresh. Reviewed patch intents are `relint_83edad48c6598dbc284cab37` and `relint_8ff894668f38ab5af3123f2b`.

The current focused suite passes 798 tests in 62 files with at most two workers, including context, schemas, repository-context, verification, writing, event contracts and both provider adapters. The first run overlapped the build: 796 tests passed and two provider inactivity-window tests timed out. That failed run is retained. After the build finished, the entire same suite passed without changing a test or timeout. The built public context package also preserves the final clause for all three ineligible intermediate dispositions in both input orders.

The corrected workspace build, type and architecture checks pass. Built CLI, Hub and Node consumers and the packed CLI consumer pass on Darwin arm64. Controlled provider and transport fixtures do not establish real provider or Discord acceptance. The complete runtime hash is `sha256:081244a21188a562d0c72710533fd9fa1945cc3f02c639b0fc77f2734de2a403`; the terminal bundle is 8,357,052 bytes, within the unchanged 8 MiB limit. Quality and documentation lifecycle checks pass. The release manifest, software bill of materials and local unsigned statement pass after regeneration through their owners. Task-base release completion against `2751dc2120e9a17d1e14524a5006c4f6dd9ee8df` is `intent_pending` for 11 changed paths, not release readiness. The previous 326-test focused run, 5,761-test full run and Linux/Windows qualifications describe preceding product bytes. Final candidate acceptance must use the corrected build. Hosted verification, final full regression and exact target-consumer qualification remain required.

The finite review inventory and exact file hashes are retained in `/tmp/lervo-source-review-current.json`. Update that current projection as the review advances; do not add a per-file or per-run canonical archive. The full pull-request source, retention and privacy attestations remain unchecked until their complete scopes are reviewed.

## Implemented boundary

Read-only artifact observations bind current local preparation, exact artifact and protected baseline bytes, writing definition, and evaluator identity. Existing writing checks run through their common evaluator port. The public CLI exposes deterministic/freshness diagnosis and reports missing semantic verification as unavailable. The subsequent [priority-2 slice](../../../specifications/execution/context-quality/task-outcome-correction.md) adds task-specific verification, explicit scoped language exceptions, and bounded correction. The subsequent [priority-3 integration](../../../specifications/execution/context-quality/host-outcome-integration.md) connects actual host completion boundaries.

Event readers support versions 1–6. Version-6 quality events use bounded schemas, strict payload validation, existing CAS and append-only storage, explicit writer activation, and supported rollback. Query, direct-hook, and managed/conversation composition now request quality recording automatically alongside their existing evidence paths. Recording remains inactive under older writer selections.

Installed qualification found a query projection defect from the preceding source slice: whitespace-word counting admitted more than the search engine's 32 terms when scheduler instructions contained identifiers, apostrophes, and paths. The projector now counts using the search engine tokenizer, reserves bounded target/alias terms, and admits whole words without cutting identifiers. Its build version is 2. Query continuation also reaches the local projection.

## Source and installed consumer checks

The final relevant suite passed 701 tests in 67 files, including schema/privacy contracts, mixed event readers, SQLite history and rollback, writer activation, repository preparation and recording, artifact verification, context delivery, both provider adapters, provider parity, CLI query/terminal behavior, and Hub/Node capability endpoints. Focused regressions cover contradictory hash-consistent outcome observations and production recording with unobserved corpus coverage.

Workspace build, type checking, package/platform architecture, quality checks, documentation lifecycle checks, and existing natural-language evaluation checks passed. The latter retains the existing 20 retrieval pairs, 32 grounding cases, reviewed historical families, and four approved real-use cases; it does not establish a new 100-family human-reviewed population. Structural review kept outcome evaluation, outcome invariants, storage, payload rules, and writer activation in separate owners. Only the cohesive schema and redaction registration catalogs required refreshed long-module hashes.

The packed 0.21.0 development consumer passed installation and public CLI checks, including explicit version-6 activation, preparation/verification recording, rollback, native Claude runtime selection, capability execution, live webhook fixture, unattended scheduler, dynamic topology, cross-provider continuation, and product-host protocol v11. Providers and external transports in these journeys use controlled fixtures. This is isolated installation evidence, not real Discord delivery, global CLI replacement, or fleet deployment.

Current installed-reader evidence observed on 2026-10-09 at 11:17:06 UTC resolved this checkout's authoritative inventory to its local reader, supporting versions 1–5. Historical fleet observations were not substituted for that current inventory. No production writer was activated and no operating service was changed.

The knowledge migration plan was ready with 1,724 operations and no blockers; it was not applied. Knowledge lint remained valid across 1,625 concepts with the same 134 issues recorded before this slice. No broad canonical rewrite was performed. Release completion remains `intent_pending`, with minor intent `relint_4b2810a271589f61dc2c641d` for this slice. Pending intent is not publication readiness.

All 103 paths in the final items-1–5 backup still exist. Before final documentation was added, 88 were byte-identical; changed paths reflect this continuation. The committed performance work was not reset.

## Frozen performance result

The [protocol](../../../../benchmarks/context-quality/recording-overhead-v1.json) compares the same candidate with optional recording disabled/enabled while writer 1 is selected. The [complete final cohort](../context-quality-recording-overhead-v1.json) retains all 30 fresh-process warm pairs, five application-cold pairs, warmups, CPU/memory/time observations, and failure dispositions. Operating-system caches and background workstation load were not isolated. No provider call was made.

The exact package artifact set was unchanged during measurement: `sha256:49194c8817c08a42956450ee6c174c1ec244ca9c005e790af64d9ebf9fc2f020`. All 70 processes completed; semantic plans were identical, and recording correctly remained inactive in the candidate arm.

| Measurement                 | Warm result                  | Application-cold result       | Frozen upper-95% gate |
| --------------------------- | ---------------------------- | ----------------------------- | --------------------- |
| Mean added preparation time | 0.54 ms; upper bound 3.90 ms | 8.65 ms; upper bound 20.72 ms | At most 10 ms         |
| Process-time ratio          | 1.033; upper bound 1.090     | 1.015; upper bound 1.074      | At most 1.20          |
| Peak-RSS ratio              | 0.999; upper bound 1.004     | 1.047; upper bound 1.155      | At most 1.25          |

The cold preparation-time gate failed, so this cohort is rejected. Shared workstation load prevents attributing the difference solely to the recording implementation, but uncertainty is not a pass. Earlier diagnostic cohorts from earlier build states are not substituted for this candidate. Thresholds were not loosened and failed samples were not removed.

## Cold recording diagnosis

Priority 1 is complete for the inactive-writer fixture. The [registered diagnostic protocol](../../../../benchmarks/context-quality/cold-recording-diagnosis-v1.json) and [complete observations](../context-quality-cold-recording-diagnosis-v1.json) retain one fixed cohort of 30 warm and 30 application-cold pairs plus ten separate phase probes. The exact package build above is unchanged. No runtime source, source coverage, retrieval limit, writer activation, or numeric acceptance threshold changed.

The earlier run overlapped this agent's test suite, packed installation, and knowledge checks. The diagnostic excludes those agent workloads during its measurement window; user and resident services continue running. Quality checks finished by 12:17:51.088 UTC, before the first pair at 12:17:51.248 UTC. Measurement ended at 12:19:18.182 UTC on 2026-10-09. Per-process host load averages and cumulative CPU counters are retained. A lossless storage encoding replaces repeated CPU field names with column names and numeric rows; `storageEncoding.decodedJsonSha256` verifies reconstruction of the complete original report. This avoids exceeding the canonical JSON source-unit bound without removing a measurement or weakening scanner coverage. These conditions do not establish an isolated machine or prove that contention alone caused the earlier failure.

| Measurement                 | Warm result                  | Application-cold result      | Unchanged upper-95% gate |
| --------------------------- | ---------------------------- | ---------------------------- | ------------------------ |
| Mean added preparation time | 0.35 ms; upper bound 0.90 ms | 0.99 ms; upper bound 1.33 ms | At most 10 ms            |
| Process-time ratio          | 0.995; upper bound 1.021     | 1.041; upper bound 1.105     | At most 1.20             |
| Peak-RSS ratio              | 1.009; upper bound 1.029     | 0.996; upper bound 1.002     | At most 1.25             |

All 120 qualification processes and ten phase probes completed. All prepared semantic signatures match, including plan digest, status, and prepared bytes; candidate recording remains `writer_not_active`. The larger, preregistered cold population passes all unchanged gates. The five-pair rejected cohort remains rejected and byte-identical; it is neither pooled into the new cohort nor replaced.

Separate probes measured core preparation without recording (mean 21.05 ms), a structured clone of its exact report and bindings (mean 0.037 ms; maximum 0.135 ms), and public writer-coordinate inspection immediately after preparation (mean 0.732 ms; maximum 1.853 ms). The probes do not directly time the complete recording operation, including payload assembly. No bottleneck warranting a production change was demonstrated. The narrow outcome is qualification of this exact inactive-writer fixture under the new measured conditions, not a general speedup or active-writer performance claim.

The benchmark entrypoint now delegates orchestration, worker measurement, and pure qualification to distinct modules. Eighteen focused tests preserve the previous bootstrap results exactly and reject missing/duplicate/nonfinite/failed/cancelled samples, semantic and warmup recording mismatches, build drift, and each independent resource-gate failure. Protocol and harness hashes bind the experiment. This evidence does not satisfy provider-quality, changed-source, concurrent-consumer, or installed-fleet acceptance.

## Priority-2 source verification

The [task outcome and correction slice](../../../specifications/execution/context-quality/task-outcome-correction.md) adds exact task-definition verdicts, scoped language exceptions with current authority checks, and bounded correction through an existing effect owner. Schema-1 observations remain readable; schema 2 carries task-check and exception evidence. The CLI can load a bounded definition but does not invent a semantic evaluator or exception authority. Missing evidence remains unavailable.

The relevant suite passed 267 tests in 38 files, including both-provider parity, context preparation, task/writing evaluation, observation compatibility, version-6 recording, correction, repository composition, CLI diagnosis, and performance-evidence decoding. A final bound-check review added oversized/invalid replacement-text and exception-policy-identity cases; the three affected files passed all 26 tests. The latter is a focused follow-up, not an additional independent 26-case acceptance population.

Workspace build, type checking, quality/structural checks, package/platform boundaries, documentation lifecycle, and built-CLI smoke passed. Responsibilities remain separate: verification owns task response validation and pure byte edits, writing owns scoped language policy, repository-context owns freshness and effect sequencing, and the CLI owns definition loading. No long-module review hash was refreshed. The repaired diagnostic evidence decodes to its exact original JSON hash; current built-CLI knowledge query succeeds without changing scanner limits or excluding sources.

Release intent `relint_b289d403ed0e1a6918279b39` records the compatible new behavior. Task-base release completion remains `intent_pending`, not publication readiness. All 158 prior paths remain present. No commit, installed fleet rollout, production writer activation, or real provider call occurred. Automatic host composition is priority 3; acceptance against human-reviewed real tasks, active-writer performance, and installed operation remain independent gates. The prior passing performance cohort still describes its recorded package build, not this newly built candidate.

## Priority-3 host integration

The [host integration contract](../../../specifications/execution/context-quality/host-outcome-integration.md) is implemented at managed CLI, managed remote, conversation reply/structured-turn, Node native repository-work, direct terminal Stop, query, and managed owner-reasoning boundaries. Default task verdicts remain unavailable without an admitted evaluator. Required policies stop completion on unavailable checks or recording; no host fabricates a semantic task pass from provider exit or project-suite success. Exact CAS reads and current local plans also apply to cached replies.

The shared operation retains failed pre-correction evidence, uses the existing effect owner, refreshes project verification, and rechecks final bytes. Read-only hosts cannot acquire correction authority. Managed isolated workspaces use their execution root; missing project/policy bindings remain unavailable. Language-exception integration exposed a redaction consistency defect: a valid passed exception observation was rejected because its diagnostic reason was treated as a failure. The event validator now permits only the known exception diagnostic on passed observations; failed-verdict reasons still fail closed.

The final broad run passed 293 tests in 45 files outside the redaction fixture. After correcting that fixture's assertion to inspect the sanitizer's returned payload, its four tests passed separately: 297 distinct tests across 46 files. Coverage includes both provider adapters, both-provider managed writer-6 recording with actual run/session correlation, native-chat context parity, managed conversation caches, repository work, terminal availability, query behavior, writer rollback, scoped exception authority, stale CAS, empty/oversized sets, and correction/project-refresh failures. A final preparation-bound review added one owner-instruction overflow case; all 16 host-outcome tests passed, bringing the distinct total to 298. Required completion and correction reject incomplete owner-clause packing while provider-native delivery remains unclaimed. Other focused reruns overlap this population and are not additional acceptance cases.

Workspace build, type checking, quality/structural checks, package/platform boundaries, and documentation lifecycle checks passed. The managed CLI now separates public contracts, provider composition, capability admission, and outcome completion; terminal preparation and Stop persistence are separate. The remaining managed-run orchestrator was reviewed again before its exact-content registry entry changed. No real provider call, deployment, global CLI replacement, or writer activation occurred in this repository. Isolated writer-6 fixtures are source tests, not installed acceptance.

Built-CLI smoke passed. Knowledge lint remained valid with the same 134 issues; the migration plan was ready with 1,727 operations and no blockers and was not applied. No broad canonical rewrite was performed.

Minor release intent `relint_43162929ae2d98b253396b65` records this slice. Task-base release completion remains `intent_pending`, not publication readiness. Previous performance evidence and all 174 paths in the priority-2 backup are retained. Earlier performance cohorts describe their original exact build and do not qualify this candidate.

## Remaining acceptance

1. Measure active-writer storage, changed-source, and concurrent-consumer cost in their own frozen protocols. Preserve both the rejected original cohort and the passing inactive-writer diagnostic.
2. Establish at least 100 real task families, human-reviewed labels, family-level held-out cases, and the required provider and changed-source/concurrent measurements.
3. Deploy a qualified exact build reader-first, collect real supported terminal and Discord journeys, and observe the seven-day/task-count cohort before claiming installed acceptance. Writer activation follows fresh exact inventory and supported rollback evidence.

## Priority-4 evaluation boundary

The [priority-4 evaluation record](context-quality-priority4-evaluation.md) adds provenance auditing, current-corpus diagnostics, and separately frozen active-writer measurements. Its 380-process resource cohort is rejected without discarded samples or relaxed limits. Functional integrity passes; latency/CPU and concurrent process-time bounds do not. The four existing human-reviewed real-use families are retained without promotion to a 100-family or unseen held-out population. This is completed bounded measurement work, not completion of priority-4 acceptance or installed rollout.

The [bounded recording storage repair](context-quality-recording-repair.md) preserves fresh writer/path and per-transaction integrity checks. It adds bounded connection borrowing, exact growing-tail receipts and pooled WAL reclamation. Final resource acceptance remains rejected; the measured improvement is reported separately from source verification and cold regression.

The [bounded commit-grouping follow-up](context-quality-commit-repair.md) adds 420 passing common storage/context/host/provider tests across 56 files, including batch rollback, late-arrival freshness and in-flight lease invalidation. Its frozen v3 cohort retains all 380 processes and passes correctness, RSS and storage, while latency/CPU and concurrent process ratios remain rejected. Concurrent observations improve modestly against v2; cold and universal resource qualification remain open.

The [fresh small metadata read follow-up](context-quality-small-read-repair.md) passes 499 tests in 64 files with bounded test concurrency and reruns 118 affected tests after error-cause cleanup. Its new 14 read cases retain exact bytes, path identities, byte bounds and large-file coverage. Frozen v4 remains resource-rejected despite lower cold/warm means against v3; source verification does not close quality or installed acceptance.

The [historical provenance recovery](context-quality-provenance-recovery.md) adds a bounded read-only audit and nine focused tests for event/CAS identity, privacy, missing original context and non-promotion of hash-only requests. It recovers approval-era evidence while retaining explicit real-task population and exact-context gaps. No runtime, ranker, provider call or writer activation changes accompany this audit.

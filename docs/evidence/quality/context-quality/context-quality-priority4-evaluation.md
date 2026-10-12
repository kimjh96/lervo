# Context quality priority-4 evaluation

Status: `evaluated_not_qualified`
As of: 2026-10-09

This bounded evaluation implements the measurement work for [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) and its [acceptance protocol](../../../specifications/execution/context-quality/performance-and-acceptance.md). It does not establish production quality or installed acceptance.

## Case provenance and remaining review

The case audit validates the existing real-use suite against its immutable review contract. Four actual task families retain their human-reviewed expected retrieval paths. Four older eight-case regression suites also retain their declared review provenance. Variants and repeated suites do not become additional real families.

All four real families were exposed to prior tuning. None is eligible as a new held-out family. Their existing review does not supply ADR-0501 clause, exact-section, negative-neighbor, and artifact labels. The initial population therefore still needs at least 96 additional real families, at least 30 unseen family-held-out cases within a 100-family population, and complete reviewed labels for all 100. Larger populations retain the minimum 30 percent family-held-out fraction. Authored tests, translations, and model judgments cannot fill this gap.

The read-only current-corpus replay compares raw and task-projected queries through the production ranker, default result limit, first-five preparation, and 12 KiB evidence and instruction profiles. Oracle paths are used only to score results. Three cases require historical workstream context that is unavailable in this replay; current workstream state is not substituted. Known expected paths cannot label every delivered byte, so relevance precision and artifact compliance remain unavailable. Existing benchmark and historical evidence documents remain in the current corpus; this is not a contamination-free held-out experiment.

Reports copy hashes, case IDs, path bindings, and bounded observations, without raw queries, conversation text, source bodies, or answers. Original owner-readable suites retain their existing access boundary. No provider requests or stochastic quality claims are made.

## Active resource protocol

The separately registered [active-resource protocol](../../../../benchmarks/context-quality/active-resource-v1.json) freezes the exact built artifact hash, 4/12 KiB profiles, 30 warm pairs, five process-cold pairs, 30 changed-source pairs, and 30 four-consumer concurrent pairs per profile. The total is 190 pairs and 380 fresh processes. Each non-cold process retains two warmups and five measured batches. Arm order alternates and each arm restores identical fixture bytes, repository path, manifest, and initial storage.

Both arms activate writer schema 6 only in disposable fixtures. The control prepares context and verifies an exact four-byte task result without recording; the candidate records preparation and verification through the existing event/CAS operations. The deterministic fixture evaluator is not a real task-quality verifier. Native instruction delivery remains unobserved. The source fixture places its operative clause after approximately 32 KiB of text. Changed-source batches select current bytes and separately probe rejection of an old hash. Concurrent consumers run together in one process; this is not multi-process writer contention.

Paired bootstrap intervals use 10,000 draws, seed 501, and two-sided 95 percent bounds. Gates retain the historical 10 ms added batch latency, 1.20 process-time ratio, and 1.25 peak-RSS ratio, and add a 1.25 CPU ratio and 128 KiB durable/rebuildable storage growth per request. Storage includes both `.lervo/data` and `.lervo/state`. Concurrent latency covers the entire four-request batch. No division hides queue or durable-write cost. The report retains every warmup, sample, failed process, semantic signature, event count, integrity observation, memory measurement, and host CPU/load observation. Column encoding preserves numeric data within the existing JSON source-unit bound.

Resource gates concern the composed fixture preparation, verification, and recording path. They do not separately attribute source scanning, projection, retrieval, provider generation, transport, or installed-host phases. Those dimensions remain open under the full acceptance protocol. Fresh process does not mean flushed operating-system caches. Resident workstation activity is uncontrolled; no agent tests, builds, installations, or knowledge scans run during the cohort.

A failed process or resource/correctness gate rejects the cohort without replacement. A repair requires a separate candidate and protocol while preserving this evidence. This is one bounded retained protocol/report pair, not an automatically growing run-history collection. Scratch repositories are removed at completion; canonical evidence remains in repository history.

## Implementation responsibility and verification

The two entrypoints only invoke evaluation and serialize reports. Separate modules own fixture storage, built artifact identity, worker measurements, process scheduling, pure qualification, provenance audit, and current-corpus diagnosis. Existing production preparation, task verification, event recording, ranker, and statistical interval implementations remain authoritative. No runtime API, rank limit, source limit, or production writer setting changes in this priority.

Focused tests cover incomplete and duplicate populations, failed/nonfinite measurements, zero CPU denominators, request cardinality, semantic mismatch, lost events, integrity and stale-source failures, storage/resource regressions, build drift, protocol weakening, actual changed/concurrent durable recording, and review/privacy boundaries. Existing natural-language evaluation regression checks retain the prior reviewed suites. The 40 focused tests and existing natural-language evaluation checks pass; they validate evaluation mechanics and retained regressions, not the missing production-quality population.

## Observed results

The [active-resource report](../context-quality-active-resource-v1.json) retains all 380 completed processes from 2026-10-09T13:30:22Z through 13:35:38Z. Build identity stayed unchanged. Every group passed paired semantic equality, exact source freshness, expected event counts, event integrity, RSS, and storage bounds. Every group failed the added-latency and CPU gates; both concurrent groups also failed the process-time gate. No process was dropped, retried, or replaced.

The following values are upper 95 percent bounds, except storage, which is the observed maximum. Concurrent latency covers all four requests together.

| Profile | Workload   | Added batch ms (limit 10) | Process ratio (limit 1.20) | CPU ratio (limit 1.25) | RSS ratio (limit 1.25) | Bytes/request (limit 131072) |
| ------- | ---------- | ------------------------- | -------------------------- | ---------------------- | ---------------------- | ---------------------------- |
| 4 KiB   | warm       | 17.07                     | 1.184                      | 1.601                  | 1.011                  | 15383.7                      |
| 4 KiB   | cold       | 22.69                     | 1.035                      | 1.297                  | 1.029                  | 61610.0                      |
| 4 KiB   | changed    | 16.62                     | 1.176                      | 1.582                  | 1.003                  | 15383.7                      |
| 4 KiB   | concurrent | 46.05                     | 1.440                      | 2.592                  | 1.036                  | 9018.0                       |
| 12 KiB  | warm       | 16.97                     | 1.178                      | 1.620                  | 1.014                  | 15383.7                      |
| 12 KiB  | cold       | 22.51                     | 1.034                      | 1.322                  | 1.007                  | 61610.0                      |
| 12 KiB  | changed    | 17.14                     | 1.181                      | 1.618                  | 1.011                  | 15383.7                      |
| 12 KiB  | concurrent | 48.68                     | 1.455                      | 2.636                  | 1.030                  | 8976.7                       |

The [case audit and current-corpus diagnosis](../context-quality-case-audit-v1.json) reports no expected reviewed paths within the returned candidates for any of the four raw or projected queries. The projected cross-provider case returned 20 candidates and prepared five; the other seven arms returned zero candidates. The context-independent external-engine case is a concrete retrieval gap in this current-corpus diagnostic. The other three cases cannot establish contextual retrieval acceptance without their original workstream inputs. These observations reject a general quality-success claim; they do not establish a new regression against a frozen historical baseline.

A separate [instrumented recording diagnosis](../context-quality-recording-profile-v1.json) retained its standalone reproduction script and exact hash. It ran 128 requests per arm with four concurrent consumers, two warmups and 30 batches. Control opened SQLite once for final inspection; candidate opened it 257 times for 256 recorded events and final inspection. Candidate integrity checks ran 258 times. Instrumented cumulative open duration was about 1216 ms, including about 564 ms in integrity checks; overlapping durations must not be summed or treated as qualification measurements. CPU samples also identify event validation, canonical serialization, and chain verification. Production source confirms each quality event independently opens and closes project storage, and opening verifies the existing chain.

The bounded next repair belongs to repository-context recording and the project-storage lifecycle: share storage only within an explicitly bounded operation/lease, preserve exact project/writer coordinates and rollback checks, retain chain validation and durable receipts, and close on success/failure. Verify concurrent admission, writer downgrade, corrupt chains, replaced project identity, cancellation/closure and event deduplication. Do not introduce an unbounded global handle cache or skip integrity checks. A new candidate must retain this rejected cohort and use a separately frozen comparison with unchanged gate floors.

Priority 4 remains open for this recording-cost repair, the real-family review/held-out population, staged/full-corpus measurements, and both providers' preregistered repeated task outcomes. Priority 5 installed rollout remains gated. The previous 207 changed paths were present and byte-identical before this evaluation's documentation updates; no earlier source implementation or performance evidence was removed.

## Completion checks

The 40 focused tests, retained natural-language regression checks, `pnpm quality:check`, package/platform architecture checks, and documentation lifecycle checks pass. A fresh built knowledge query succeeds with unchanged corpus limits. The three new evidence JSON files extract 15,062, 428, and 28 key units respectively, below the existing 16,384-unit bound. Exact protocol, harness, and built artifact hashes still match the measured cohort. Structural review found no mixed-responsibility exception or long-module hash refresh.

`pnpm release:completion:check --base 53eec5565af89eae2a18acd2d39cd99d78358a61` succeeds with `intent_pending` for 223 changed paths. This evaluation adds no bundled behavior; earlier reviewed release intents remain applicable to the implementation. `intent_pending` is not release readiness. No provider calls, production activation, installation, deployment, commit, or push occurred.

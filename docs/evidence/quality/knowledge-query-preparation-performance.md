# Knowledge-query preparation performance

As of: 2026-10-09
Task base: `8cb3e0a759a7f6dd1b55204ba26b4348ebeea943`
Status: local implementation and paired performance verified; installed rollout pending

## Scope

[ADR-0497](../../decisions/operations/storage/0497-reuse-exact-event-page-verification.md) removes repeated event-chain validation work and the duplicate execution/verification traversal. Every raw event row remains inspected. Repository sources, source-unit extraction, privacy checks, ranking, and all existing coverage limits remain unchanged.

This is an in-process preparation optimization, not a persistent query cache or a search-quality change. New processes still verify their entire history. Repository scanning remains a separate cost. No installed rollout or provider-answer quality improvement is claimed.

## Paired observation

Five warmup pairs preceded 30 recorded alternating baseline/candidate pairs in one Node process on macOS arm64. Each arm opened and closed project storage, collected evidence, prepared repository knowledge with the same Lexical v2 adapter, and executed three queries (English, mixed-language, and a synthetic probe). OS caches were warm; other host workloads were not controlled. Startup and provider execution are outside these measurements. The synthetic probe contains common lexical tokens, so it does not establish zero-hit behavior.

The baseline restored the task-base `SQLiteEventRepository.verifyIntegrity` method and task-base repository-context collector from Git, transpiled without changing their logic. All other dependencies, repository bytes, policy, ranking, and source-unit extraction were shared with the candidate. This isolates the two production changes rather than comparing different repositories or installed bundles.

| Phase                                      | Baseline p50 | Candidate p50 | Baseline p95 | Candidate p95 |
| ------------------------------------------ | -----------: | ------------: | -----------: | ------------: |
| Execution/verification evidence collection |  2,136.56 ms |     953.11 ms |  2,303.86 ms |     990.34 ms |
| Repository preparation                     |  2,534.03 ms |   2,518.41 ms |  2,768.64 ms |   2,703.50 ms |
| Three prepared queries                     |     21.32 ms |      21.37 ms |     24.11 ms |      24.41 ms |
| Combined elapsed time                      |  4,712.00 ms |   3,492.93 ms |  5,071.36 ms |   3,723.13 ms |
| Process CPU time                           |  5,108.40 ms |   3,867.88 ms |  5,745.75 ms |   4,276.28 ms |

Evidence collection median fell 55.39 percent, combined median 25.87 percent, and CPU median 24.28 percent. CPU includes process threads and may exceed elapsed time. Prepared-query ranking time was effectively unchanged.

Every arm returned exactly 4,154 supplemental sources and source snapshot `ksnap_d62e0c6651d718bcc6829959`. All 30 pairs matched both the hash of the complete ordered source array and the hash of the three complete query results. No mismatch or slow sample was excluded. This establishes equality for this observation, not universal production relevance or answer quality.

The bounded [current measurement report](knowledge-query-preparation-performance.json) retains all 60 samples, runtime coordinates, counts, and digests without query text, source bodies, or host identity. Its compact-JSON SHA-256 is `0b4f184e01115d373e920b8be213e0dcb595962c2d49e9ad4d84c089ce6f55da`. This report replaces the current observation on future measurement; Git retains history.

The benchmark ran before this evidence document and report received their final bytes. The snapshot above binds the measured corpus. The comparison does not earn the broader full-inspection, persistent-cache, seven-day installed, or provider-settlement gates.

## Validation

Focused storage and repository-context tests cover byte-bound reuse, corrupt older events, changed predecessors, rollback/truncation, cross-connection mutation, report isolation, exact shared projection, privacy-invalid older evidence, and final verification failure. The 33,000-event regression retains the existing 4,096-source window without weakening full-history validation.

Storage, repository-knowledge, repository-context, project-storage, and event-reader suites passed 153 tests. CLI integration passed 40 tests; the common Codex and Claude adapter suites passed 39 tests, for 232 focused tests in total. Full workspace build, source type checking, quality/formatting, package/platform boundaries, brand checks, and documentation lifecycle checks passed. The built CLI smoke passed at source version 0.21.0; this is not a deployment of a new release.

Knowledge migration planning returned `ready` with 1,708 operations and zero blockers; the plan was not applied. Subsequent knowledge lint returned `valid: true`. Task-base release completion passed as `intent_pending` for 17 changed paths, with reviewed patch intent `relint_d1f33c9f223056552b23fcac`. Release preparation, publication, and installed rollout remain separate.

Structural review keeps chain validation in one SQLite adapter module, evidence-window policy in repository knowledge, and composition in repository context. No source module crosses the long-module threshold or adds provider/platform dependencies. The public event-store contract and persistent formats remain unchanged.

# Validation and remaining acceptance

## Failed runs and corrections

The initial full suite ran 841 files: 800 passed, 34 failed, seven skipped. Reader-version expectations, release dependency classification, source coordinates, bounded context queries, and derived release owners were corrected. A later four-worker full run retained four failed files: one incorrectly registered Node test suite and five concurrency-sensitive supervision timeouts. Registration now uses Vitest; all 20 tests in the three supervision files passed in isolation. Failed runs remain evidence, not passing checks.

## Final passing validation

The final full run passed 846 files and 4,266 tests, skipped seven files/eight tests, and had no failures in 1,070.85 seconds. It used two workers and 30-second default test/hook timeouts; explicit test and production deadlines were unchanged. It includes actual process death and corrected delivery coverage.

Additional focused runtime, provider/recovery, managed-provider, and workspace/schema/reader/Hub groups passed 26, 19, 53, and 37 tests. Quality, types, package boundaries, documentation, build, and built CLI/Node/Hub smoke checks passed. Packed CLI fixtures verified protocol v11, cross-provider continuation, webhook trigger, unattended scheduler, and dynamic topology. Task-base release completion passed as `intent_pending` with reviewed minor intent: preparation, not publication. Final knowledge lifecycle results are in the current workstream.

## Watchers, provider output, and supervision

Previously silent in-process filesystem-watch journeys pass with bounded source-metadata fallback and an active-wait kill-switch probe. The isolated scheduler/replica suite passed 14 tests; the repository watcher passed nested-edit/request/cache-exclusion coverage.

Malformed native owner output retains actual raw results and failed-run evidence, acknowledges invocation termination only with exact stop and observed usage, and enters bounded correction across restart. Missing stop/usage or conflicting captures remain uncertain. That regression and 53 managed-provider lifecycle/failure tests pass. Standing-successor and earlier supervision timeout journeys pass in the final full run; higher-concurrency failures remain recorded.

## Remaining installed acceptance

At this boundary, acceptance still required:

- A real human Discord response during observed background work.
- Process-death rehearsals across all integration/outcome windows.
- Native Claude convergence when quota permits.
- Reviewed per-project activation.

Exact source responsibility, terminal reopening/archival, workspace closure/cleanup, and repeated native changed-draft integration are observed only at stated boundaries. Failed/uncertain workspace retirement and unresolved identity/history retention remain bounded by capacity stops, not silent discard. This implementation turn performed no production rollout; separately authorized continuation is recorded separately.

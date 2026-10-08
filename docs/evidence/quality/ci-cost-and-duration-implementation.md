# CI cost and duration implementation evidence

As of: 2026-10-08
Task base: `7a5cce30966063861b2927be85d20be31f7e4627`
Scope: owner-approved source implementation and subsequent commit, push, and CI rollout. The local measurements below precede remote rollout; hosted results require separate run receipts.

## Implemented contract

[ADR-0496](../../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) implements the [approved design](../../roadmap/operations/ci-cost-and-duration.md). The workflow has one exact Linux build producer, four consumers, conservative documentation-only admission, full manual/daily fallbacks, and an aggregate that rejects missing, failed, or cancelled required checks. Release generation follows successful current-main CI, publishes a reviewable candidate with verification pending, explicitly verifies its exact SHA, binds release admission to the versioned aggregate job name, and independently requires full merged-main CI before tags.

The dispatcher rejects malformed or same-revision comparison bases, and absent ancestry retains an unresolvable base instead of silently inspecting an empty HEAD-to-HEAD diff. A marked PR body block preserves surrounding user text. An unmarked or ambiguous existing body stops reconciliation. Branch updates retain an exact predecessor lease. Verification may cancel; Git effects remain serialized and non-cancellable. No npm authority changed.

## Test-time measurement

Two expiry/recovery scenarios passed with both the original real-time wait and the replacement cross-process test clock on the same local host. The control was a temporary copy of the task-base test and was removed after measurement. The complete optimized file passed all eleven lifecycle scenarios.

| Measurement        | Original wait | Optimized clock |
| ------------------ | ------------: | --------------: |
| Late completion    |     191.199 s |        19.166 s |
| Late recovery      |     191.209 s |        30.312 s |
| Combined scenarios |     382.408 s |        49.479 s |

The paired scenarios avoided 332.930 seconds, approximately 87.1%. The optimized full file took 284.133 seconds. These runs shared the host with other validation work, so the comparison establishes removed intentional waits rather than a stable CI throughput estimate. The historical hosted full-file duration was 528.082 seconds; that is a different environment and is not a paired whole-file baseline.

The fixture advances Date in the supervisor and managed CLI subprocess, explicitly proves both observed lease expiry, preserves monotonic timers and semantic assertions, and restores the environment and global clock after each case. Production lease policy and provider adapters are unchanged.

The supported minimum Node 22.13.0 additionally passed both scenarios in 16.38 and 17.26 seconds. The minimum-runtime focused run passed 31 selected tests across seven files; its twelve filtered cases were not claimed as executed. All 33 infrastructure tests across six files also passed without filters on Node 22.13.0, including a shell-orchestration fixture proving failed current-main admission stops candidate publication before remote writes. Existing PR ownership is checked before publishing the candidate branch.

## Build, coverage, and distribution evidence

- `pnpm build` completed all 103 workspace projects. Actual create/restore transferred 102 output directories with matching identity and SHA-256. Executable-mode roundtrip, stale-output removal, corruption, missing archives, wrong SHA/Node/platform/workflow/run identity, earlier-producer retry, out-of-scope archive members, symbolic links, and destination-parent links have focused regression coverage.
- The actual Vitest configuration discovered 1,041 files. Applying its CI sequencer assigned 247, 265, 264, and 265 files to the four shards; their union matched discovery exactly with no duplicates. Estimated weights were 687.799, 688.163, 687.548, and 688.107 seconds. These are placement estimates, not measured runner durations. `vitest list --shard` alone does not apply the sequencer and was not used as coverage proof.
- The bounded duration profile retains at most 128 paths. Hosted timings from run 37706186392 supply the historical weights; the old native-completion weight is replaced by the explicitly labeled local optimized-file observation. New files receive a collection weight and remain included.
- `pnpm release:manifest:check` passed five files and 100 portable dependencies; `pnpm release:sbom:check` passed 224 components and 109 nodes.
- `pnpm release:attestation:check`, built CLI/Hub/Node checks, Hub/Node standalone distributions, packed CLI consumer installation, and isolated registry-publication preflight passed. These were local fixtures and temporary package operations, without npm publication.
- Official actionlint 1.7.12 accepted both changed workflow files. Node 22.13.0 and actionlint downloads were verified against their official SHA-256 lists; no system runtime was replaced.

## Final four-shard acceptance

The corrected source passed the actual CI sequencer on Node 22.13.0 with two workers per shard. All four commands exited zero. Their discovered-file union exactly matched all 1,041 files, without duplicates. In total, 5,145 tests passed, zero failed, and eight existing platform/conditional cases were skipped.

| Shard | Files | Passed tests | Skipped tests | Local elapsed |
| ----- | ----: | -----------: | ------------: | ------------: |
| 1     |   247 |        1,140 |             2 |     518.038 s |
| 2     |   265 |        1,382 |             1 |     675.840 s |
| 3     |   264 |        1,320 |             3 |     653.661 s |
| 4     |   265 |        1,303 |             2 |     694.426 s |

These four local processes shared one Mac host and ran concurrently. The 694.426-second longest shard does not include the workflow's producer, quality, artifact upload/download, or distribution jobs, and is not a hosted CI duration or cost result. The native-completion file passed all eleven cases under this shared-host load in 473.785 seconds; its earlier isolated 284.133-second result supplies the clearly labeled placement weight. This variation reinforces the need for hosted timing acceptance.

The full-run failure investigation and focused retries below are retained to distinguish intermediate failures from final clean shard acceptance. No assertion was removed, no default test deadline was increased, and no test file was excluded to obtain the passing result.

## Local completion and remaining acceptance

The initial full run on local Node 26.5.1 discovered 1,041 files and reported 5,114 passed, 30 failed, and eight skipped tests. System power logs establish repeated host sleep during that run; several failed durations exceeded 900 seconds and cleanup reported concurrent temporary-directory writes. That run is failed evidence, not a throughput benchmark. A scoped sleep-prevention assertion and Node 22.13.0 retry passed all 30 previously failing cases across twenty files in 192.93 seconds, with 138 intentionally filtered cases. Because runtime and power state changed together, this does not isolate the sole cause of every failure. A complete unfiltered minimum-runtime rerun exposed a separate legacy-peer test fixture failure: it writes a long stderr usage message and immediately forces `process.exit(1)`. The original fixture reproduced on the supported runtime in isolation. A direct differential probe received only 8,192 of 20,089 bytes with immediate exit and all 20,089 bytes with `process.exitCode = 1`, both exiting 1. [Node 22.13 documentation](https://nodejs.org/download/release/v22.13.0/docs/api/process.html#processexitcode) confirms that forced exit can truncate pending output. Only the fixture was changed to let stderr drain; replica parsing, transport failure semantics, and runtime code remain unchanged. The corrected fixture's full three-case suite passed. The unfiltered minimum-runtime run otherwise passed 5,144 tests, with that one already-collected old fixture failure and eight skipped tests across 1,041 files. Final acceptance runs the four actual CI shards concurrently after the fix and records their results below.

Final source-contract validation passed `pnpm quality:check` (including structural review of 62 existing long modules and script architecture across 702 modules), typecheck, package/platform boundaries, document lifecycle (533 registered documents), brand checks, and natural-language evaluation. Every relative link in the ten touched Markdown documents was also independently checked. `pnpm lervo knowledge lint --json` returned `valid: true` across 1,622 concepts, with 123 non-blocking diagnostic entries; its document-freshness report still contains 56 stale and 1,464 unevaluated documents, so lint success is not a claim of complete knowledge normalization. A read-only live GitHub observation of the task-base SHA returned `blocked / release_exact_ci_not_found`, as expected without the new versioned aggregate; no release effect was performed. Actual aggregate-command fixtures passed documentation-only and full dispositions and failed cancelled-test and missing-plan dispositions, with complete failed receipts. The latest `pnpm release:completion:check --base 7a5cce30966063861b2927be85d20be31f7e4627` returned `not_required` for the bounded CI, test, and documentation paths. The final actual build-transfer roundtrip restored 102 directories with digest `sha256:7edc9f01068e48d50921433433822d727d9aea55bc878bd012dd8a1d0ad04830`; manifest and SBOM checks passed afterward.

The implementation changes CI/release infrastructure, tests, and documentation outside the released runtime closure; the task-base completion inspector determines whether release intent is required. No provider adapter changed, so its common-contract obligation introduces no new adapter suite. This is not a repository-wide knowledge-lifecycle change; knowledge migration is not part of this scope.

Every touched source was reviewed against the code convention. Pure change classification, revision observation, aggregate evaluation, build transfer, shard assignment, and Vitest adaptation have separate quality owners. Pure release admission, GitHub observation, PR rendering, command translation, and candidate/tag shell orchestration have separate release owners. Bash syntax checks passed for both orchestration files. Native provider simulation and test time have separate fixtures. Entrypoints stay short; no production long-module exception or deferred structural split was introduced.

The owner subsequently authorized commit, push, and deployment of this CI scope. Hosted acceptance remains open: ordinary code, documentation-only, generated-candidate, merged-main/tag, stale/cancelled, failed-job retry, and Linux/macOS/Windows matrix cases require observed run receipts. Required-check settings must use the aggregate without requiring intentionally skipped jobs. GitHub's [workflow event contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [artifact upload contract](https://github.com/actions/upload-artifact) inform the configured handoff and rerun behavior; local checks do not establish those hosted outcomes.

The baseline's gross build opportunity is 16.0–19.8 runner-minutes per full CI before transfer overhead. Preparation's 5–15 minute target does not include candidate verification. At least five comparable full runs and seven days of complete lifecycle usage, including candidate/main/daily verification, cancellation, transfers, and artifact storage, are required before claiming cost acceptance. No actual invoice or repository-wide savings percentage is established.

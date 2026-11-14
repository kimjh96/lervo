# CI test reuse shadow evidence

As of: 2026-11-15
Scope: measurements behind [ADR-0565](../../decisions/operations/services/0565-record-what-each-ci-test-file-reads-before-reusing-its-result.md) and the [shadow contract](../../foundation/ci-test-reuse-shadow.md). Hosted shadow reports require separate run receipts.

## Stage 1 local ledger

A local run of shard 1 of 4 on Node 22.13 with the recorder on passed 307 files. The two failing files failed the same way with the recorder off, because of the local environment. It wrote a 1.84 MB ledger for 315 files: 7,694 paths and 405 process records. The 27 MB spool stays on the runner. With this change's own files counted as tracked, 259 of the 315 files had a complete closure. The rest had these reasons:

- `host_state` in 43 files. In 37 of them, capability discovery probes `~/.lervo/capabilities/packages`, because the test setup isolates `LERVO_USER_STATE_DIRECTORY` but not `LERVO_USER_CAPABILITY_ROOT`. TypeScript's case-sensitivity probe and a `/.dockerenv` probe were also recorded.
- `unobserved_child` in 26 files, mostly fixtures and providers started with an environment that drops `NODE_OPTIONS`.
- `git_in_repository` in 5 files.
- `untracked_input` in 3 files, from four unmapped CLI build outputs: `.tsbuildinfo`, `bin.metafile.json`, `repository-runtime.json` and `terminal-hook-launcher.mjs`.

Five files then exceeded the child bound, before identical children were collapsed.

## Hosted ledgers and Stage 2 dry run

The first hosted ledgers, from [run 43619547245](https://github.com/kimjh96/lervo/actions/runs/43619547245), gave 1,021 complete closures in 1,267 files. In 77 files, the only reason was `host_state` from the capability probe. The Vitest setup now isolates `LERVO_USER_CAPABILITY_ROOT` like the user state directory. A WSL run of those 77 files with the ledger on recorded a complete closure for all 77, so the same suite would have 1,098 complete closures (86.7%). On that host, with Node 26.5, the same 36 of the 77 files failed with and without the fix, because the repository source gate could not be acquired; the hosted shards passed all 77.

A Stage 2 dry run on WSL applied the committed predictor to hosted ledgers. It rebuilt each run's tree from its revision, a frozen install and its build artifact. Rebuilding the changed packages without a change reproduced all 7,585 indexed digests, so the rebuilt outputs equal the CI bytes. Each index took 1.4 to 3.5 seconds and about 1 MB; each prediction took under 3 seconds.

| History → head (run 43619547245's files)                          | Predicted reuse | False reuses |
| ----------------------------------------------------------------- | --------------- | ------------ |
| Same run, unchanged rerun                                         | 1,021 (80.6%)   | 0            |
| Run 43614766532 → next push (three test files changed)            | 1,017 (80.3%)   | 0            |
| Same pair, with each shard's actual G                             | 507 (40.0%)     | 0            |
| Unchanged rerun plus one edit in `packages/execution-reliability` | 1,019 (80.4%)   | not run      |
| Unchanged rerun plus one edit in a CLI command                    | 981 (77.4%)     | not run      |
| Unchanged rerun plus one edit in `packages/core`                  | 659 (52.0%)     | not run      |

Run 43614766532 had a failed shard, so the rules would not trust it; the dry run trusted it to measure input changes, and none of its failed files was predicted reusable. Every unchanged rerun reused exactly the complete closures. The pair of pushes reran three files through `input_changed` on the changed fixture, and 633 files through `toolchain_changed` (`platform`) when each shard kept its own runner image build. The edit rows predict only; their tests were not run.

Reuse by file count overstates the time saved. In the unchanged rerun, the 246 rerun files still took 2,620 of the 4,076 seconds of file time. `uncacheable_unobserved_child` alone took 1,820 seconds in 105 files, `uncacheable_host_state` 592 seconds and `uncacheable_git_in_repository` 139 seconds. With the current placement, the shard jobs of 734, 477, 537 and 624 seconds would take an estimated 523, 312, 360 and 449 seconds. The `packages/core` edit would leave 661, 412, 474 and 566 seconds. Three to five minutes per shard therefore needs children observed and fewer host reads, not only reuse.

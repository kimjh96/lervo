# CI test reuse shadow

Status: `active`
As of: 2026-11-15

This document specifies Stage 2 of [ADR-0565](../decisions/operations/services/0565-record-what-each-ci-test-file-reads-before-reusing-its-result.md): the shadow comparison that predicts per-file test reuse on every CI run without skipping any test. The ADR holds the decision and the reuse rules. [Shadow evidence](../evidence/quality/ci-test-reuse-shadow.md) holds the measurements.

## Shadow job

**Job.** `Test reuse shadow` needs the plan, the build and the test shards. It runs when coverage is full, tests were not reused, the build succeeded, the shards succeeded or failed, and `LERVO_CI_TEST_LEDGER` is not `off`. It has `continue-on-error`, no job needs it, and the aggregate does not read it. It uses the workflow's read-only token (`contents: read`, `actions: read`), no secret, and only actions pinned to the SHAs other jobs use. Its entrypoint `scripts/quality/ci-test-shadow.mjs` prints one line and exits 0 on any failure.

**Reconstructed tree.** The job checks out the run's revision, installs with the frozen lockfile and restores the run's validated build. That is the tree each shard started from, before any test could change it. It refuses ledgers recorded for another revision.

**Input index.** Ledgers name inputs but hold no contents. The job therefore digests every file input, every test file and every copied tree that this run's ledgers name, in the reconstructed tree, and publishes them as `lervo-ci-test-input-index` (`input-index.json`, contract `lervo-ci-test-input-index-v1`) for seven days. It holds the run ID, the revision and one closed digest string per repository-relative path, and no contents. Anyone holding a run's ledgers, revision and build artifact can rebuild it. `ci-test-shadow-inputs.mjs` defines the digests, so two values are the same input exactly when the strings are equal:

| Digest                         | Meaning                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `file:<x\|->:<sha256>`         | A regular file's bytes, and whether its owner may execute it.                                                           |
| `link:<target>><digest>`       | A symbolic link's target text, and the digest of what it resolves to.                                                   |
| `tree:<sha256>`                | A copied directory: each entry's relative path and digest, without following links. A copied file keeps its own digest. |
| `directory`, `absent`, `other` | A directory, a missing path, or a socket, FIFO or device.                                                               |
| `unreadable`                   | Inspection failed or passed a bound (512 MB per file, 50,000 tree entries). It never matches.                           |

Listings and absent paths need no index. The predictor recomputes a listing digest at the head with the recorder's own text from `ci-test-input-listing.cjs`, and checks absent paths with the recorder's existence rule. Built outputs are compared by their own bytes in the restored build, not through the build-output map. A source mapping cannot see a changed build script, an esbuild define, or a TypeScript import whose elision depends on another file. The map still decides which outputs are `untracked_input`.

**History.** The job lists completed Code quality runs of this repository created in the last 30 hours, newest first, skips the current run and forks, and loads at most 25 runs that published ledgers. A run is trusted when it verified `main` (a push or the daily audit) or when it is a pull request whose four test shards all succeeded. A dispatched candidate and a pull request with a failed shard are untrusted. Trusted runs also load their input index. A ledger or index naming another run, or an index for another revision, rejects that run. Any API or download failure skips the run and is listed in the report, so it can only cause reruns.

## Rerun reasons

The ADR's rules are applied by the pure `ci-test-shadow-prediction.mjs`. Candidates are tried newest first, and the first reusable one is the prediction. Otherwise the file reruns with its newest candidate's reason, so a reason names the result Stage 3 would have tried first. Only a recent failure, the ADR's rule 6, can override a reusable candidate. The reasons are closed:

| Reason                      | Meaning                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `no_history`                | No loaded run recorded the file, or none had finished when this run started.    |
| `untrusted_history`         | Only untrusted runs recorded the file.                                          |
| `history_expired`           | The newest trusted record is older than 24 hours, or has no time.               |
| `toolchain_changed`         | G differs; the detail names the differing components.                           |
| `not_passed`                | The record did not pass, for example a skipped file.                            |
| `uncacheable_<reason>`      | The record had that Stage 1 reason, for example `uncacheable_host_state`.       |
| `input_digests_unavailable` | The run published no input index, or the index lacks a recorded path.           |
| `input_changed`             | A recorded file input or the test file has another digest, or was unreadable.   |
| `tree_changed`              | A copied tree has another digest.                                               |
| `listing_changed`           | A recorded listing digest matches neither listing of the directory at the head. |
| `absent_path_appeared`      | A path the file found absent now exists.                                        |
| `prior_failure`             | A run recorded the file failing under the same G within 24 hours.               |

## Report

The job publishes `lervo-ci-test-shadow` (`shadow-report.json` and `shadow-report.md`, contract `lervo-ci-test-shadow-v1`) for 30 days, so the 14-day bar can be read from reports without keeping ledgers longer than seven days. The report holds:

- the run, its shards' distinct G, and each history run with its event, branch, trust and index, or the code that skipped it;
- the predicted reuse count and rate, false reuses, and predicted reuses that have no result in this run;
- each false reuse with its source run, expected result and actual result;
- rerun reasons ranked by file count, with this run's file time and the 10 most common details;
- per shard, the file time executed, the file time that would still run and, when the shard job's duration is known, an estimated job duration: that duration less the reusable file time divided by the shard's two workers, under the current placement;
- one line per file.

The job summary shows the same tables, with false reuses first, and each false reuse adds an error annotation. Reports and indexes hold repository-relative paths, digests, run IDs, counts and closed codes only. A missing report is missing evidence, never a verdict.

Neither the predictor nor the report enters G. The planner pattern excludes `ci-test-shadow-*` modules, because they only read finished ledgers and cannot change a test's result.

## Verification

`ci-test-shadow-prediction.test.mjs` builds real trees and indexes and checks reuse for unchanged inputs and a rerun with the right reason and detail for a source edit, a rebuilt output, the test file itself, a deleted input, an executable bit, a retargeted link, a changed or extended copied tree, a new entry in a plain or recursive listing and an absent path that appears. It also covers the TTL, a missing time, a toolchain change and its component, an unpassed or uncacheable record, a missing index or index entry, an unreadable digest, untrusted and unfinished runs, revocation by failures under the same G within the TTL only, and newest-first candidates. `ci-test-shadow-report.test.mjs` checks false reuses by result and test counts, unverified predictions, reason ranking with file time, and shard estimates. `ci-test-shadow-run.test.mjs` checks trust for each event, branch, fork and shard outcome, and runs the whole job against a Git fixture with fake API and downloads: index first, a skipped run, a false reuse annotation, and refusal of another revision. `ci-test-input-recorder.test.mjs` checks that the shadow listing digest equals the recorder's for the same directory.

## Known gaps

The recorder (Stage 1):

- `process.emit` becomes an own property of `process`, so `Object.hasOwn(process, "emit")` is true and `process.emit` no longer equals `EventEmitter.prototype.emit`. Listeners run with one recorder frame below them.
- Hooks still call built-in prototype methods, such as `String.prototype.startsWith` or `Set.prototype.has`, at call time. A program that replaces those methods can observe the recorder.
- A worker killed within a second of its file's last hook loses the observations made after that hook.
- SQLite database paths are not observed. Replacing `DatabaseSync` would change its identity, and loading `node:sqlite` early would print its experimental warning in every process. A process that loaded it gets the note `sqlite_unobserved`. No database file is tracked in the repository.
- Paths given as a Buffer or a file descriptor are not observed. Existence and listings are read when the record is spooled, so a repository path a test creates or deletes in between shows its later state.
- Each wrapped synchronous call adds one recorder frame to stacks captured inside it. The limit rises by one during the call, so the caller's frames still fit, and is restored only if the call left it unchanged. Still, a stack captured inside the call has one extra line, and a synchronous callback inside it, such as an `fs.cpSync` filter, reads a limit one higher. `Function.prototype.toString` of a wrapped function or of `Date` prints `function () { [native code] }`. On 2026-11-14, no test asserted on stacks, limits or that source text, and `errorThrowSite`, the one product reader of stack frames, skips errors with a string `code`, as all filesystem and child process errors have.
- `performance.now()`, `process.hrtime()`, `Date()` called as a function, `fs.watch` and `dgram` are not observed. Worker threads run the preload and spool their own records, but a thread stopped by `Worker#terminate()` can lose its record without any reason being recorded.
- Garbage collection timing changes, because the preload allocates. A process that holds a resource only through an object it no longer references can lose it sooner. In CI, three test children lost an SQLite lock or transaction this way. They now keep the holder referenced, and a transparency row checks that only an unreferenced lock is released.
- A record holds at most 50,000 paths per kind and 2,000 child entries. Children that cannot have a record of their own, such as Git or a child started without the recorder, collapse into one counted entry per identical command.

The shadow comparison (Stage 2):

- G is strict. In run 43619547245, shards 1 and 4 ran on runner image build `20261111.370.1` and shards 2 and 3 on `20261111.127.1` of the same release. Such files rerun as `toolchain_changed` with the detail `platform`. Whether G may drop the build number needs separate evidence that both builds install the same tools.
- The predictor takes each file's G from the current run's ledger. Stage 3 must compute G in the shard before it decides.
- The index digests the reconstructed tree. A file that reads a repository path another file in its shard wrote is compared against the unwritten content. Listings are recorded when the record is spooled, so a listing that includes such a write reruns instead.
- A rerun attempt overwrites its shard's ledger, so a failure in an earlier attempt is lost as revocation evidence.
- A run cancelled before its shadow job publishes no index, so its results are never reused.
- Real-clock reads are counted but are not a reason. A result that depends on the date can be predicted reusable for 24 hours. The daily audit still reuses nothing.
- The estimated shard duration keeps the current placement and two workers. It does not rebalance the files that would still run.

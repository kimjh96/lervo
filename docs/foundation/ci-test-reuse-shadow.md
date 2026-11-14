# CI test reuse shadow

Status: `active`
As of: 2026-11-15

This document specifies Stage 2 of [ADR-0565](../decisions/operations/services/0565-record-what-each-ci-test-file-reads-before-reusing-its-result.md): the shadow comparison that predicts per-file test reuse on every CI run without skipping any test. The ADR holds the decision and the reuse rules. [Shadow evidence](../evidence/quality/ci-test-reuse-shadow.md) holds the measurements, and [known gaps](ci-test-reuse-shadow-gaps.md) lists what is not yet observed.

One rule governs every part: anything the recorder or the predictor cannot prove identical means rerun. A shadow run that observed no false reuse proves nothing on its own, because inputs rarely change in the ways a defect needs, so each kind of input and change is also covered by a test matrix.

## Shadow job

**Job.** `Test reuse shadow` needs the plan, the build and the test shards. It runs when coverage is full, tests were not reused, the build succeeded, the shards succeeded or failed, and `LERVO_CI_TEST_LEDGER` is not `off`. It has `continue-on-error`, no job needs it, and the aggregate does not read it. It uses the workflow's read-only token (`contents: read`, `actions: read`), no secret, and only actions pinned to the SHAs other jobs use. Its entrypoint `scripts/quality/ci-test-shadow.mjs` prints one line and exits 0 on any failure.

**Reconstructed tree.** The job checks out the run's revision, installs with the frozen lockfile and restores the run's validated build. That is the tree each shard started from, before any test could change it. It refuses ledgers recorded for another revision.

## What the recorder adds for reuse

Ledgers use contract `lervo-ci-test-ledger-v2`. A version 1 closure is never compared (`ledger_outdated`); its timings are still read.

- **Writes.** Every process records the repository paths and dependency keys it writes: `writeFile`, `appendFile`, `open` with any writing flag, `mkdir`, the parent of `mkdtemp`, `rm`, `rmdir`, `unlink`, both sides of `rename`, the destination of `copyFile`, `cp`, `symlink` and `link`, `truncate`, `chmod`, `chown`, `utimes` and their variants, and `createWriteStream`. The source of `rename` and `link`, and a symlink's target, are also read inputs, because the bytes become readable under another name.
- **Unreadable paths.** A Buffer path is read as the UTF-8 text it spells, because Node's own `fs.rm` passes Buffers. A file descriptor needs no observation, because the `open` call that returned it was recorded with its path and flags. Every other path argument the recorder cannot read as text, such as a `FileHandle`, a Buffer that is not UTF-8 or an object it cannot inspect, is noted `unobserved_path`, or `unobserved_write` for a writing call. So is a call to `glob` or `watch`, whose inputs cannot be named, and any observation that fails, such as a relative path when the working directory is gone. An `open` with an unreadable path counts as a write unless its flags only read.
- **Listings.** A plain and a recursive listing of one directory are separate entries. A `recursive` option that the hook cannot read records both.

Two uncacheable reasons join the Stage 1 list. `unobserved_input` means the file's closure holds an unobserved path. `shard_written_input` means another process of the shard may have changed a path in the closure: the test file, an input, a copied tree, a listed directory, an absent path or a dependency key. Paths overlap when they are equal or one contains the other, and the repository root contains everything. Writes by the file's own processes do not count, because they follow from its own inputs. Some writers cannot be seen: a process with an `unobserved_write`, a record that dropped writes past its bound, and a child working inside the repository whose own complete record is not in the shard, because it ran without the recorder or spooled elsewhere. The ledger summary lists them, earliest first, with the file that started each and its start time in the shard. Read-only Git subcommands such as `rev-parse`, `ls-files` or `status` are exempt, because they write only inside `.git`, whose readers are already `git_in_repository`. Git with only global options such as `--version` and `git clone` or `git init` whose every operand is outside the repository are also exempt. Every other unseen writer makes every other file of the shard `shard_written_input`, unless the file finished first. Records carry wall-clock times taken with the original `Date.now`, so a file whose processes all spooled their final record more than one second before the writer started cannot have read its writes. Seen writes are not ordered, because a file can read a path again after its last record.

## Digests

**Input index.** Ledgers name inputs but hold no contents. The job digests, in the reconstructed tree, the test file and every recorded input, the `package.json` scopes of each, the resolution neighbourhood of each, and every copied tree. It publishes them as `lervo-ci-test-input-index` (`input-index.json`, contract `lervo-ci-test-input-index-v2`) for seven days. The index holds the run ID, the revision and one digest per repository-relative path, and no contents. Anyone holding a run's ledgers, revision and build artifact can rebuild it.

`ci-test-shadow-inputs.mjs` defines each digest as a JSON value with a `kind`. Values are compared after a canonical serialization with sorted keys, and only when both are certain:

| Kind         | Holds                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `file`       | Full permission bits, size and the SHA-256 of the bytes.                                               |
| `directory`  | Full permission bits.                                                                                  |
| `link`       | Its own permission bits, the target text and the digest of what it resolves to.                        |
| `other`      | A FIFO, socket or device, with its permission bits.                                                    |
| `absent`     | Nothing exists at the path.                                                                            |
| `tree`       | A copied path, seen both as a copy that keeps links and as one that follows them, plus its top entry.  |
| `neighbours` | The typed entries that share the input's stem, and for an `index.*` input also those of its directory. |
| `unknown`    | Inspection failed or passed a bound (512 MB per file, 50,000 tree entries). It never equals anything.  |

A digest with `unknown` anywhere inside, such as a link to an unreadable target, is uncertain. Modification times are left out, because every checkout changes them, so a test that asserts on a repository file's time is not reusable.

Module resolution probes files it never reads, and Vite resolves in the main Vitest process, which no file's record sees. A neighbourhood therefore holds every entry next to an input that `./name` could resolve to, so a new `x.js` beside an imported `x.ts` is a change. Node also reads the nearest `package.json` for a module's type, so each `package.json` from an input's directory up to the repository root is an input.

**Listings.** The listing digest hashes the JSON of the kind and every entry's relative name and type, from `ci-test-input-listing.cjs`, which the recorder and the predictor share. Names containing newlines, a plain listing that looks like a recursive one, and a file replaced by a link cannot collide. A recursive listing walks without following links and gives up past 100,000 entries. A listing the recorder could not take is `unlisted`, which never matches.

**Built outputs** are compared by their own bytes in the restored build, because a source mapping cannot see a build script, an esbuild define or a cross-file TypeScript elision. The map still decides which outputs are `untracked_input`.

## Environment

G holds a digest of the whole environment of the test process except the run-unique variables in `CI_TEST_RUN_UNIQUE_ENVIRONMENT`, and the variable names. It never holds a value. The ref, the event and `NODE_OPTIONS` are therefore part of G, so results are reused only within one ref and event. The excluded variables differ on every run or revision by construction, so a key holding them could never match:

- `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER`, `GITHUB_RUN_ATTEMPT`, `GITHUB_SHA` and `GITHUB_WORKFLOW_SHA`;
- the step command files `GITHUB_ENV`, `GITHUB_OUTPUT`, `GITHUB_PATH`, `GITHUB_STATE` and `GITHUB_STEP_SUMMARY`, whose names hold a fresh identifier;
- `RUNNER_NAME`, `RUNNER_TRACKING_ID` and `ACTIONS_ORCHESTRATION_ID`, which name the machine and the job;
- `INVOCATION_ID`, `JOURNAL_STREAM`, `SYSTEMD_EXEC_PID` and `MEMORY_PRESSURE_WATCH`, which systemd sets for the runner service.

Ledgers also record, outside G, the kernel release and a SHA-256 of each variable's value, with names that may hold a credential withheld, so a reader can find a variable that still differs between shards.

A process reads a variable by its name, so a closure is `run_environment_read` when one of those names occurs where code can read the variable in the test file, a recorded input, or a package it loaded. In text that means quoted, as a member, in a shell expansion or destructured from an environment object; in a binary file, any whole token. A package that cannot be found or scanned in full counts as naming them. Recording the reads themselves would need a Proxy of `process.env`, an exotic object whose replacement tests can observe.

## History

The job lists every completed Code quality run of this repository created in the last 30 hours, skipping the current run, forks and other workflows. A run is trusted when it verified `main` (a push or the daily audit) or when it is a pull request whose four test shards all succeeded. Untrusted runs still load their ledgers, because a failure they recorded revokes reuse. Trusted runs also load their input index. A ledger or index naming another run, or an index for another revision, is a load failure.

Loading fails closed. Each of the following makes the history incomplete and every file `history_incomplete`:

- a run list that cannot be read, or more than ten pages of runs;
- a run whose artifacts or jobs cannot be read;
- a shard whose `Run tests` step ran without a ledger artifact, which includes runs with the ledger switched off;
- a download or a ledger that fails to read.

## Rerun reasons

`ci-test-shadow-prediction.mjs` applies the ADR's rules. It is pure; the head arrives as digest lookups and an environment scan. Candidates are tried newest first, and the first reusable one is the prediction. Otherwise the file reruns with its newest candidate's reason. Only a recent unpassed result, the ADR's rule 7, overrides a reusable candidate. The reasons are closed:

| Reason                      | Meaning                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `history_incomplete`        | A run of the window failed to load.                                            |
| `no_history`                | No loaded run recorded the file, or none had finished when this run started.   |
| `untrusted_history`         | Only untrusted runs recorded the file.                                         |
| `history_expired`           | The newest trusted record is older than 24 hours, or has no time.              |
| `ledger_outdated`           | The record comes from a version 1 ledger.                                      |
| `toolchain_changed`         | G differs; the detail names the differing components.                          |
| `not_passed`                | The record did not pass, for example a skipped file.                           |
| `uncacheable_<reason>`      | The record had that uncacheable reason, for example `uncacheable_host_state`.  |
| `input_digests_unavailable` | The run published no input index, or the index lacks a path.                   |
| `input_unverifiable`        | A recorded or current digest, or a listing, is uncertain or has no kind.       |
| `input_changed`             | The test file, an input or a `package.json` scope has another digest.          |
| `resolution_changed`        | An input's resolution neighbourhood changed.                                   |
| `tree_changed`              | A copied tree has another digest in either view.                               |
| `listing_changed`           | A recorded listing differs from the head's listing of the same kind.           |
| `absent_path_appeared`      | A path the file found absent now exists.                                       |
| `run_environment_read`      | The closure names a run-unique variable.                                       |
| `prior_failure`             | A run recorded the file failed or unfinished under the same G within 24 hours. |

## Report

The job publishes `lervo-ci-test-shadow` (`shadow-report.json` and `shadow-report.md`, contract `lervo-ci-test-shadow-v1`) for 30 days, so the 14-day bar can be read from reports without keeping ledgers longer than seven days. The report holds:

- the run, its shards' distinct G, whether the history is complete, each history run with its event, branch, trust and index, and each load problem;
- the predicted reuse count and rate, false reuses, and predicted reuses that have no result in this run;
- each false reuse with its source run, expected result and actual result;
- rerun reasons ranked by file count, with this run's file time and the 10 most common details;
- per shard, the file time executed, the file time that would still run and, when the shard job's duration is known, an estimated job duration: that duration less the reusable file time divided by the shard's two workers, under the current placement;
- one line per file.

The job summary shows an incomplete history and false reuses before every table, and each false reuse adds an error annotation. Reports and indexes hold repository-relative paths, digests, run IDs, counts and closed codes only. A missing report is missing evidence, never a verdict. Neither the predictor nor the report enters G: the planner pattern excludes `ci-test-shadow-*` modules, because they only read finished ledgers.

## Verification

`ci-test-shadow-false-reuse.test.mjs` is the property matrix. For a file, a symlink, a copied tree, a plain and a recursive listing, an absent path and a directory's metadata, it applies each of content, type, mode, rename, create, delete and link retarget changes in a real tree and requires a rerun. Each cell a kind cannot observe, such as a file's content for a listing, is named with its reason and must stay reusable. The environment and toolchain rows change a variable's value, add, remove or rename one, change the ref, and change, add, remove, replace or rename a toolchain file. The same file keeps the review regressions r1, r2 and r6 to r9; `ci-test-ledger.test.mjs` keeps r3, `ci-test-shadow-run.test.mjs` r4 and `ci-test-input-recorder.test.mjs` r5.

`ci-test-shadow-prediction.test.mjs` covers each rule: the TTL, a missing time, an outdated ledger, a toolchain change and its component, unpassed and uncacheable records, missing indexes and entries, unknown digests and listings, an incomplete history, untrusted and unfinished runs, revocation by unpassed results under the same G within the TTL only, newest-first candidates, package scopes, and run-unique names in sources and packages. `ci-test-shadow-run.test.mjs` covers trust for each event, branch, fork and shard outcome, every load failure, and runs the whole job against a Git fixture with fake API and downloads. `ci-test-input-recorder.test.mjs` checks recorded writes, link targets, open flags and unreadable paths through a real recorder, and that the shadow listing digest equals the recorder's. `ci-test-input-transparency.test.mjs` adds rows for the write calls, unreadable path shapes and the shapes of every newly wrapped function.

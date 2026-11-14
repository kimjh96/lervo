# ADR-0565: Record what each CI test file reads before reusing its result

Status: `proposed` (Stage 1, observation only, is accepted; reuse is not enabled)
Decision date: 2026-11-14
Builds on: [ADR-0522](0522-reuse-ci-verification-for-identical-content.md) (whole-tree reuse), [ADR-0564](0564-prepare-the-release-inside-the-feature-pull-request.md) (the daily audit reuses nothing)

## Context

ADR-0522 reuses test results only when the whole test digest matches, so any source change reruns all 1,256 test files. Each of the four shards spends 390 to 606 seconds collecting (importing) files, on top of 420 to 930 seconds of tests. Per-file test time also varies a lot between runs. In the latest full run, shard jobs took 7.9 to 14.4 minutes even though the planner had balanced them by one run's test time.

Reusing one file's result needs a key that changes whenever anything the file depends on changes. A key predicted from imports alone would miss child processes, built outputs, directory listings and files that tests probe but do not find. This design therefore observes what each test file actually reads. The future key is the recorded closure plus a toolchain digest, G.

## Decision

Delivery happens in three stages. This ADR accepts Stage 1 only.

### Stage 1: recorder and ledgers (observation only)

Nothing in Stage 1 changes which tests run, their order within Vitest's isolation, or how the aggregate judges them.

**Recorder.** `scripts/quality/lib/ci-test-input-recorder.cjs` is preloaded into every Vitest worker with `NODE_OPTIONS=--require`. Children inherit the preload through `NODE_OPTIONS`. CommonJS is used because a `--require` preload does not start the ESM loader. The forks pool with isolation runs one test file per worker process. The setup file `ci-test-input-binding.mjs` binds the worker to its file and exports `LERVO_CI_TEST_FILE` to children. Each process records the following:

- Repository paths that fs and fs/promises read, stat, test for existence, open for reading, list or copy. The call only names the path; when the record is spooled, the recorder checks whether it exists and digests a listed directory's sorted names. A path that does not exist then goes into `absent`. Reads under `node_modules` collapse to one pnpm store key per package.
- Module loads. Node's loaders read module sources through the public fs API: CommonJS always, ESM through `fs.promises.readFile` on Node 22.13 and through `readFileSync` from Node 22.15. The fs wrappers therefore observe them, with no `module.register` thread. That thread measured 34 ms per process and about 0.75 ms per module on Node 22.13. The worker also lists vite-node's module cache, because Vitest serves repository modules over RPC instead of reading them. `process.dlopen` adds native addons.
- Child processes: command, a bounded argument tail, working directory, PID when the API exposes it, and whether the child inherited the recorder.
- Outgoing connections. Loopback and local sockets are only counted; other endpoints are recorded by host and port.
- Real-clock reads: `Date.now()` and `new Date()` without arguments, made by test or product code. The fake timer `Date` never reaches these counters.

Records hold repository-relative paths, `~`-relative host paths, package keys, counts and closed codes. They never hold file contents, environment values or credentials. The recorder installs no signal, `exit` or `beforeExit` listener, because any listener changes Node's default behavior or `process.listenerCount`. While observations arrive, it rewrites the process's spool file at most once a second, so a hard kill keeps the record so far. A Proxy of `process.emit` marks the record `end: exit` after the `exit` event, and a worker's binding marks it `end: file` after its file's last hook, because the pool kills workers instead of letting them exit. The ledger treats a record without its end marker as incomplete. Every wrapper returns or throws exactly what the original did, and a recorder error only loses the record.

Wrappers follow `ci-test-input-transparent-call.cjs`. Each wrapped function is a Proxy of the original, so its name, length, prototype, constructibility and own properties are the original's. Hooks read only primitives, own data properties of non-Proxy objects, and URL fields through URL's own getter. They use only the built-ins that `ci-test-input-intrinsics.cjs` captured at preload, such as the original `Error`, `Reflect` and `process.cwd`, never a global looked up at call time. A static scan in the transparency test fails when a recorder function body names one. They never run a getter, a Proxy trap or a string conversion, and a value they cannot read is reported as unknown. They never touch results, errors, callbacks or promises, so timing and unhandled rejections stay the same. `Module._load` and `node:sqlite` are not wrapped. A `require()`-loaded ESM graph is found in the CommonJS cache when the record is spooled. `ci-test-input-transparency.test.mjs` runs one program per row with the recorder off and on and requires identical output and exit.

**Ledger.** The reporter in `ci-test-ledger-reporter.mjs` runs beside Vitest's own default reporters. It writes `ledger-shard-<i>-of-<n>.json` with:

- `run`: run ID, attempt, revision, observation time and shard coordinates.
- `toolchain`: G and its components.
- `paths`: the shard's path table. Each path appears once, and files refer to it by index.
- `buildOutputs` and `unmappedBuildOutputs`: a note that maps built outputs to sources. The CLI bundle maps through its esbuild metafile, generated schema validators through their manifest's hashed inputs, native addons to G, and other `dist` files to the tracked source with the same stem.
- `files[]`: `file`, `result`, `tests` counts, `durationMs`, `collectMs`, `inputs`, `directories` (path and listing digests), `trees`, `absent`, `dependencies`, `untracked`, `children`, `network`, `host`, `clock`, `processes`, `notes`, `uncacheableReasons` and `toolchainDigest`.
- `summary`: counts of files, complete closures, reasons and records.

A file's closure joins its worker with every child the ledger can match, by PID or, for synchronous APIs, by parent PID and argument tail. Children that Vitest's worker starts before it is given a file, such as tinypool counting CPUs, belong to the toolchain. A ledger above 32 MB keeps results and reasons but drops the path lists, and every file in it is then marked `module_graph_unavailable`.

**Uncacheable reasons.** Each file lists the reasons its closure cannot yet key a reuse. The list is closed:

| Reason                     | Meaning                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `unobserved_child`         | A child ran without a complete record: not Node, Node without the recorder, or a record without its end marker.             |
| `git_in_repository`        | Git ran with its working or Git directory inside the repository, or the process read `.git` directly.                       |
| `network`                  | A connection left the host.                                                                                                 |
| `host_state`               | A read or probe outside the repository, temporary directories, the toolchain and system image paths, for example under `~`. |
| `untracked_input`          | A repository path that Git does not track and no generated-output mapping explains.                                         |
| `module_graph_unavailable` | No complete worker record exists, a record hit its bound, or Node 22.13 loaded an ESM graph through `require()`.            |

Git outside the repository runs on test-owned fixtures with the Git version in G, so it is not a reason. Loopback connections, temporary paths and clock reads are recorded without making a file uncacheable.

**Toolchain digest G.** `ci-test-toolchain-digest.mjs` hashes the lockfile, the workspace manifests (without the CLI version, as in ADR-0522), tracked tsconfig and Vitest configuration files, setup and global setup files, the parsed `test` job of the workflow, the recorder and planner modules, the native artifacts under `dist/native`, the Node, pnpm and Git versions, and the runner image name, version and architecture. Any change to these invalidates every file at once.

**Shard weights.** The sequencer now reads profile weights. A version 1 profile keeps its meaning: test time plus a 1.5-second overhead per file. A version 2 profile holds test plus collection time and a default weight for unlisted files. `refresh-test-durations.mjs --ledgers <run directories>` builds it from the median over the newest five runs, configurable with `--window`. A file that no selected run measured keeps its current weight only while a selected run lacks a shard's ledger. The planner still assigns every file to exactly one shard.

**Kill switch.** The test job reads the repository variable `LERVO_CI_TEST_LEDGER`, `on` by default. With `off`, the configuration adds no preload, setup file or reporter, and the upload step is skipped. Each shard uploads its ledger as `lervo-ci-test-ledger-<shard>` with `if: always()`, 7-day retention and `continue-on-error`, so a failed or cancelled shard still has a ledger, and a failed upload never fails the shard. Planning, reuse, receipts and the aggregate never read ledgers.

### Stage 2: shadow comparison

A shadow planner computes, for every run, which files Stage 3 would have reused. It does not skip any of them. It compares each predicted reuse with the file's actual result. A false reuse is a predicted reuse whose actual result or test counts differ. Stage 2 runs for at least 14 days. It refines the recorded surfaces and generated-output mappings until there have been zero false reuses over the whole period.

### Stage 3: reuse

Only after Stage 2 meets its bar does a separate decision enable per-file reuse. The key will be the recorded closure's content digests plus G, and a reused file will point at the run that executed it, as ADR-0522 does for whole components. The daily audit continues to reuse nothing.

## Known gaps

These gaps are recorded, not hidden:

- `process.emit` becomes an own property of `process`, so `Object.hasOwn(process, "emit")` is true and `process.emit` no longer equals `EventEmitter.prototype.emit`. Listeners run with one recorder frame below them.
- Hooks still call built-in prototype methods, such as `String.prototype.startsWith` or `Set.prototype.has`, at call time. A program that replaces those methods can observe the recorder.
- A worker killed within a second of its file's last hook loses the observations made after that hook.
- SQLite database paths are not observed. Replacing `DatabaseSync` would change its identity, and loading `node:sqlite` early would print its experimental warning in every process. A process that loaded it gets the note `sqlite_unobserved`. No database file is tracked in the repository.
- Paths given as a Buffer or a file descriptor are not observed. Existence and listings are read when the record is spooled, so a repository path a test creates or deletes in between shows its later state.
- Each wrapped synchronous call adds one recorder frame to stacks captured inside it. The limit rises by one during the call, so the caller's frames still fit, and is restored only if the call left it unchanged. Two differences remain. A stack captured inside the call has one extra line. A synchronous callback inside it, such as an `fs.cpSync` filter, reads an `Error.stackTraceLimit` one higher. `Function.prototype.toString` of a wrapped function or of `Date` prints `function () { [native code] }`. On 2026-11-14, no test asserted on `stack`, `stackTraceLimit`, `prepareStackTrace` or the source text of these functions. The one product reader of stack frames, `errorThrowSite`, skips errors that carry a string `code`, as every filesystem and child process error does.
- `performance.now()`, `process.hrtime()`, `Date()` called as a function, `fs.watch` and `dgram` are not observed. Worker threads run the preload and spool their own records, but a thread stopped by `Worker#terminate()` can lose its record without any reason being recorded.
- A record holds at most 50,000 paths per kind and 2,000 child entries. Children that cannot have a record of their own, such as Git or a child started without the recorder, collapse into one counted entry per identical command.

## Consequences

The recorder changes each test process in ways that tests can detect only by looking for them. The process gains wrapped builtins whose prototypes' `constructor` points at the wrapper, a `Date` proxy, an own `process.emit` property, `NODE_OPTIONS` and `LERVO_CI_TEST_FILE`. If a recorder defect breaks tests, setting `LERVO_CI_TEST_LEDGER=off` restores the previous behavior without a commit.

Measured on WSL with Node 22.13, the recorder's own CPU time in the worker for `apps/cli/test/cli.test.ts` was about 0.25 seconds of 18 seconds. With the Proxy wrappers, it adds about 1 µs to each repository fs call or listing, 0.5 µs to each temporary-path call or clock read, nothing measurable to a Git spawn, and about 7 ms to the startup and exit of each recorded Node child. A directory is digested once, when the record is spooled. Paired runs of three heavy files varied more from host load than from the recorder.

A local run of shard 1 of 4 on Node 22.13 with the recorder on passed 307 files. The two failing files failed the same way with the recorder off, because of the local environment. It wrote a 1.84 MB ledger for 315 files: 7,694 paths and 405 process records. The 27 MB spool stays on the runner. With this change's own files counted as tracked, 259 of the 315 files had a complete closure. The rest had these reasons:

- `host_state` in 43 files. In 37 of them, capability discovery probes `~/.lervo/capabilities/packages`, because the test setup isolates `LERVO_USER_STATE_DIRECTORY` but not `LERVO_USER_CAPABILITY_ROOT`. TypeScript's case-sensitivity probe and a `/.dockerenv` probe were also recorded.
- `unobserved_child` in 26 files, mostly fixtures and providers started with an environment that drops `NODE_OPTIONS`.
- `git_in_repository` in 5 files.
- `untracked_input` in 3 files, from four unmapped CLI build outputs: `.tsbuildinfo`, `bin.metafile.json`, `repository-runtime.json` and `terminal-hook-launcher.mjs`.

That run predates the child collapse. Five files then exceeded the child bound and were also marked `module_graph_unavailable`.

## Verification

`ci-test-input-recorder.test.mjs` runs a real program with the recorder and checks reads, listings, absent probes, ESM and CommonJS loads, dependency keys, children with and without the recorder, Git inside and outside the repository, loopback and external connections, clock counts and the SQLite note. It also checks byte-identical results with and without the recorder, the final record and exit signal on SIGTERM, and inertness when the switch is off. `ci-test-ledger-reporter.test.mjs` runs a nested Vitest with the ledger on, checks the ledger written for it, checks that a write failure never fails the run, and checks the configuration switch. `ci-test-ledger.test.mjs` covers the path table, each reason, child matching, output mappings and the size bound. `ci-test-toolchain-digest.test.mjs` covers digest stability and every component. `ci-test-shards.test.mjs` and `ci-test-duration-profile.test.mjs` cover weights, medians and exact-once assignment. `ci-test-input-transparency.test.mjs` holds one row per transparency defect found in review, including thrown values whose `code` getter throws, non-enumerable environment getters, small stack limits, connect option getters, a constructible `Date.now`, SQLite constructor identity, function shapes, getter and Proxy trap counts, promise ordering, unhandled rejections and stack formatters. `code-quality-workflow.test.mjs` checks the switch, the upload and that no other job reads ledgers.

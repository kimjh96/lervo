# CI test reuse shadow gaps

Status: `active`
As of: 2026-11-15

These are the known gaps of the recorder and the [shadow comparison](ci-test-reuse-shadow.md) of [ADR-0565](../decisions/operations/services/0565-record-what-each-ci-test-file-reads-before-reusing-its-result.md). A gap that can hide a changed input must close before Stage 3 enables reuse.

## Inputs that can still go unseen

- **Timestamps.** Modification and access times are not digested, and the recorder cannot see which fields of a `Stats` object a test reads without wrapping it. A test that asserts on a repository file's time can be predicted reusable.
- **Writers outside the repository.** A child without a record of its own, started outside the repository, is assumed to write only there. One that writes into the repository through an absolute path is not seen.
- **Temporary files.** Reads under temporary directories are not inputs, because tests create their own. A file that reads a temporary path another file of its shard wrote, or one a setup step left, such as the workflow event file, is not detected.
- **Environment by computed name.** A process that reads a run-unique variable through a computed name, or by iterating `process.env`, is not found by the name scan.
- **Unhooked readers.** Node's internal readers that bypass the public `fs` functions, such as the module resolver's existence checks and `package.json` reader, are covered only through resolution neighbourhoods and package scopes. Reads by the main Vitest process, including Vite's resolution, belong to no file.
- **SQLite and other bindings.** SQLite database paths are not observed. Replacing `DatabaseSync` would change its identity, and loading `node:sqlite` early would print its experimental warning in every process. A process that loaded it gets the note `sqlite_unobserved`. No database file is tracked in the repository.
- **Spool timing.** Existence and listings are read when the record is spooled. A worker killed within a second of its file's last hook loses what it observed after that hook. A thread stopped by `Worker#terminate()` can lose its record without any reason.
- **Real clock.** `performance.now()`, `process.hrtime()`, `Date()` called as a function and `dgram` are not observed, and clock reads are counted without making a file uncacheable. A result that depends on the date can be predicted reusable for 24 hours. The daily audit still reuses nothing.

## Recorder side effects

- `process.emit` becomes an own property of `process`, so `Object.hasOwn(process, "emit")` is true and `process.emit` no longer equals `EventEmitter.prototype.emit`. Listeners run with one recorder frame below them.
- Hooks still call built-in prototype methods, such as `String.prototype.startsWith`, `Set.prototype.has` or `Dirent.prototype.isFile`, at call time. A program that replaces those methods can observe the recorder.
- Each wrapped synchronous call adds one recorder frame to stacks captured inside it. The limit rises by one during the call, so the caller's frames still fit, and is restored only if the call left it unchanged. A synchronous callback inside it, such as an `fs.cpSync` filter, reads a limit one higher. `Function.prototype.toString` of a wrapped function or of `Date` prints `function () { [native code] }`. On 2026-11-14, no test asserted on stacks, limits or that source text.
- Garbage collection timing changes, because the preload allocates. In CI, three test children lost an SQLite lock or transaction held only through an unreferenced object. They now keep the holder referenced, and a transparency row checks that only an unreferenced lock is released.
- A record holds at most 50,000 paths per kind and 2,000 child entries. Children without a record of their own, such as Git or a child started without the recorder, collapse into one counted entry per identical command.

## Costs of failing closed

- **Unseen writers.** With every test passing, each shard has 15 to 18 files that start a child without a record of its own in the repository: mostly the `apps/node-runtime` supervision provider fixtures, then `ps`, `pnpm`, `chmod`, `esbuild`, `tar`, `mv` and `bash`. They start 20 to 140 seconds into the shard, so almost every file is `shard_written_input`. The next bounded changes are a write model for commands that write only their path operands, such as `chmod` and `ps`, and starting the provider fixtures with the recorder or outside the repository. Verify each with a shard ledger whose `unseenWriters` and `shard_written_input` counts fall.
- **Short-lived recorded children.** A child that inherited the recorder but was killed before its first spool, within a second, has no record and counts as unseen.
- **Strict G.** In run 43619547245, shards 1 and 4 ran on runner image build `20261111.370.1` and shards 2 and 3 on `20261111.127.1` of the same release. Such files rerun as `toolchain_changed` (`platform`). Dropping the build number needs evidence that both builds install the same tools.
- **Unobserved environment.** The hosted test environment has not been observed with this G. A variable that changes on every run and is not excluded makes every file `toolchain_changed` (`environment`). The names in G's components show which variables exist.
- **Shard writes.** Overlap is by path containment and ignores order, so a write anywhere below a listed directory, or by any other process to the repository root, reruns the file.
- **History.** One run that fails to load stops all reuse for 30 hours, and so does a run with the ledger switched off. A rerun attempt overwrites its shard's ledger, so an earlier attempt's failure is lost as revocation evidence. A run cancelled before its shadow job publishes no index, so its results are never reused.
- **Stage 3.** The predictor takes each file's G from the current run's ledger. Stage 3 must compute G in the shard before it decides. The estimated shard duration keeps the current placement and two workers.

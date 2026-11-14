# Cycle cost observation

Each completed host-resident cycle reports what it spent, so fence and capture work can be measured before it is redesigned. The report counts work; it proves no currency, freshness, ownership or authority.

## Output

`lervo knowledge worker --watch --host` prints one line per completed cycle: `{ repositoryRoot, result, cost }`. Skipped cycles print nothing, as before. `cost` is:

- `gitProcesses`: Git processes the cycle started.
- `wallMilliseconds` and `cpuMicroseconds`: elapsed time and process CPU (`process.cpuUsage()`, user plus system) for the cycle.
- `scopes`: per scope, `{ calls, wallMilliseconds, cpuMicroseconds, gitProcesses }`, where `gitProcesses` maps each Git subcommand, such as `rev-parse` or `ls-files`, to a count.

The cost covers the fence observation and the full cycle. Publication and health projection refreshes run afterwards and are not included.

## Scopes

Scope names are fixed labels in code, joined by `/` and nested at most four deep:

- `fingerprint`: the change fence.
- Worker phases: `terminal_skills`, `artifact_retention`, `freshness_prepare`, `retention`, `owner_turns`, `owner_rules`, `practice`, `change_review`, `convergence` and `freshness`.
- Within `convergence`: `discover`, `dependency`, and `<stage>.<phase>` for each host call, where the phase is `prepare`, `assert_current`, `run` or `settle`. Calls made before the owner claims a stage use `discovery` as the stage.
- Nested work: `provider_poll` (the once-per-second check during a provider call), `capture` (one complete source capture), `scan` and `tool_ownership`.

Git processes count only in the innermost scope. Wall and CPU time are inclusive: a scope's time also contains its nested scopes.

## Attribution and bounds

Git processes are attributed through the async context that started them, so work for another repository in the same host process is never counted. Asynchronous spawns are observed through Node's `child_process` diagnostics channel. Synchronous spawns publish nothing there, so each synchronous Git call site records itself. CPU time is the whole process's, so concurrent residents share it.

A report holds at most 256 scopes and 48 subcommands per scope; further ones count under `other`. A label that is not a lowercase identifier also counts as `other`.

## Privacy and failure meaning

The report carries counts, fixed scope labels and timings only: no path, argument, output or body. Observation never fails a cycle and never changes its result. When nothing observes process cost, scopes are plain calls. The report is not persisted and records no canonical event.

# Pinned deliberation CLI changes

If an existing configuration directly pins an older deliberation CLI, prepare an exact owner-only candidate changing only its `cliExecutable` references. A [guarded Node upgrade](transition-guards.md) may add `--configuration-source <candidate.json>` while retaining the running configuration path.

The manager verifies stop before replacing configuration bytes and the frozen admission digest. Failure restores both before restarting the predecessor. An unresolved private transition journal requires recovery, not another unchecked attempt.

Reader rehearsal must include these pinned CLI entrypoints before enabling a newer event writer.

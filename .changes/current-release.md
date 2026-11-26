<!-- lervo-release package="@lervo/cli" version="0.58.0" schema="1" -->

## What's changed

- Knowledge commits are no longer held by a REBASE_HEAD that Git left behind after a rebase ended; only a running rebase, merge, cherry-pick, revert, bisect, or index lock holds them.
- Repository snapshots walk while Git lists ignored paths again, using the previous capture's list for paths it saw, which cuts about 25 ms from each prompt and Stop snapshot with identical results.
- Served prompts reuse the measured distance between the workstream's recorded commit and HEAD while HEAD has not moved, instead of running two git commands per prompt.
- Terminal hooks record how their answer was delivered: the context server's answer time, or the closed reason a hook ran in its own process. Repository upgrades activate event schema 13 once every configured reader reads it.

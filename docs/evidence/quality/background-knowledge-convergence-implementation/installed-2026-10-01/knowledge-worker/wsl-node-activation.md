# WSL Node bundle and blocked activation

An isolated WSL worktree built the matching Linux Node distribution after the call-budget source fix, committed there as `7e465ee396a`. Archive `sha256:06fb9dc64d7eadbefe233deac62a505e579879f5400ca2bec76f8a4c70e84dcc` independently verified as 0.18.0 `linux-x64-glibc` with 5,826 entries, then installed at `/home/jonghyeok/.local/lib/lervo-node/call-budget-0.18.0-20261001`.

WSL type checking, six focused tests, quality checks, and release completion with `intent_pending` passed. A canonical service definition and exact predecessor copy were prepared.

Two guarded Node upgrade attempts returned `service_upgrade_supervision_busy`. The installed bundle was not enabled; the previous service remained active with zero restarts. Read-only lock inspection found PID 354 holding SQLite read and write locks for `supervision.discord.standing.s4`, the current standing binding.

Before any service transition, the worker still reported `normalization_budget_exceeded` and `baselineCurrent: false`. No installed call-budget recovery is claimed.

# Event writer reader-first rollout

Status: `active`

As of: 2026-09-11

Activate repository-local event writers only after all required readers support the target version. Activation changes future writes; it never rewrites history.

- [Safety boundary](event-writer-rollout/safety.md): version requirements, selection behavior, and membership authority.
- [Activation](event-writer-rollout/activation.md): local-only and Hub-enabled evidence, planning, apply, and verification.
- [Writer rollback](event-writer-rollout/rollback.md): return to version 1 writing while retaining compatible readers.
- [Interrupted apply](event-writer-rollout/recovery.md): explicit transaction recovery before resuming writers.

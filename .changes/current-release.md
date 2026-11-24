<!-- lervo-release package="@lervo/cli" version="0.47.0" schema="1" -->

## What's changed

- Add lervo workspace retire and the ADE core command workspace.retire, which remove a hosted workspace without discarding work: they refuse a worktree in use or with changes, and keep a branch whose commits the default branch lacks.

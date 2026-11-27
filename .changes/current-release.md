<!-- lervo-release package="@lervo/cli" version="0.67.0" schema="1" -->

## What's changed

- lervo workspace retire --discard-changes, and workspace.retire with discardChanges, remove a workspace with its uncommitted changes after keeping a copy of them under refs/lervo/retired-changes, at most 10 copies for 14 days.
- Retiring an ADE conversation now releases its lease, records, and changed paths with the coordination gate closed, and lervo upgrade sweeps conversations whose worktree is gone.

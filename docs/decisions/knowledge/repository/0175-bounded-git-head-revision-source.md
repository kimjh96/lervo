# ADR-0175: Bounded Git HEAD Revision Source

- Status: accepted
- Decision date: 2026-08-23

## Context

Working-tree snapshots did not identify the observed commit. Collecting branches, authors, messages, remotes, or history would add unnecessary privacy exposure and repository semantics.

## Decision

`git-head-revision-v1+git-rev-parse` runs exactly `git rev-parse --verify --end-of-options HEAD^{commit}` without a shell. It accepts one lowercase 40-character SHA-1 or 64-character SHA-256 followed by LF, limits each output stream to 256 bytes and execution to five seconds, and disables prompts and optional locks.

Success creates an ordinary virtual `@git/HEAD` `revision_metadata` source whose content is the object name plus LF. Its `revision:HEAD` unit version binds the stable ID, exact bytes, and adapter. It changes only with HEAD; working-tree changes continue to affect the repository snapshot independently.

The adapter runs before and after file scanning. Any status or content drift fails the entire scan as `knowledge_source_unsafe`. Missing Git, a nonrepository or unborn HEAD, timeout, exit or stderr output, malformed name, or overflow becomes bounded `unsupported/git_head_unavailable` with no unit and without distinguishing the cause.

The full `snapshotId` includes revision sources for semantic plans and impacts. `contentSnapshotId` excludes them from Git-carried structural output to avoid commit-induced self-reference. The adapter collects no branch, identity, message, tag, remote, diff, status, or history and invokes no hooks, credential prompts, network access, writes, or mutations.

Errors omit paths, object names, outputs, actors, remotes, and secrets. Commit coordinates remain local inventory and compiler input, not runtime events.

## Consequences

Fixtures verify two commits, exact ranges, stable IDs, isolation from uncommitted changes, unsupported non-Git state, before/after races, packed CLI behavior, and dogfood without new runtime dependencies.

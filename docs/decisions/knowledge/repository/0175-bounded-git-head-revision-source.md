# ADR-0175: Bounded Git HEAD Revision Source

- Status: accepted
- Decision date: 2026-08-23

## Context

Working-tree snapshots did not identify the observed commit, while collecting branches, authors, messages, remotes, or history would add unnecessary privacy and repository semantics.

## Decision

git-head-revision-v1+git-rev-parse runs exactly git rev-parse --verify --end-of-options HEAD^{commit} without a shell. It accepts one lowercase 40-character SHA-1 or 64-character SHA-256 plus LF, bounds each output stream to 256 bytes and execution to five seconds, and disables prompts/optional locks.

Success creates ordinary virtual @git/HEAD revision_metadata whose content is the object name plus LF. Its revision:HEAD unit version binds stable ID, exact bytes, and adapter; it changes only with HEAD, while working-tree changes still affect repository snapshot independently.

The adapter runs before and after file scanning. Any status/content drift fails the whole scan as knowledge_source_unsafe. Missing Git, nonrepository, unborn HEAD, timeout, exit/stderr, malformed name, or overflow becomes bounded unsupported/git_head_unavailable with no unit, without distinguishing cause.

Full snapshotId includes revision sources for semantic plans and impacts. contentSnapshotId excludes them for Git-carried structural output, avoiding commit-induced self-reference. The adapter collects no branch, identity, message, tag, remote, diff, status, or history and has no hooks, credential prompt, network, write, or mutation.

Errors omit paths, object names, outputs, actors, remotes, and secrets. Commit coordinates stay local inventory/compiler input, not runtime events.

## Consequences

Fixtures verify two commits, exact ranges, stable IDs, uncommitted-change isolation, unsupported non-Git state, before/after races, packed CLI, and dogfood without new runtime dependencies.

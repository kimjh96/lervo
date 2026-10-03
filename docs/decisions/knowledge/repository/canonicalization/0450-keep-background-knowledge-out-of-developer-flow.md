# ADR-0450: Keep background knowledge out of the developer flow

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md) and [ADR-0357](../../../execution/verification/0357-prepare-isolated-candidate-verification-workspaces.md)

## Context

After ADR-0446 through ADR-0449, Mac convergence reached `current` and followed each new commit. Two costs still affected developers:

- **Verification rebuilt the monorepo.** Every `repository.default.v9` run began with `pnpm build`, which took 170-330 seconds under load and was 60-70% of each run. A documentation-only cycle could run the suite five times, rebuilding unchanged code and rewriting `dist` in the developer's working tree. Integration worktrees always built from scratch.
- **Settled outputs remained uncommitted.** Reviewed normalization rewrites, their records, and integrated drafts stayed in the working tree. Developers kept finding unexplained changes and making cleanup commits; five such commits followed one day of convergence. A commit after `current` moved `HEAD` and staled HEAD-bound publication and instruction bridges. That started another lifecycle cycle.

## Decision

- **Build reuse.** Verification preparation computes a digest of exact build-input bytes. The digest covers tracked and untracked nonignored files, excluding Markdown, `docs/`, `.lervo/`, `.changes/`, and `*.tsbuildinfo`. Preparation skips the build only when a recorded successful build has the same digest and its CLI, Node, and Hub bundles exist.
- **Shared build archives.** Successful builds are archived by digest under the Git common directory, keeping the two newest archives. A worktree with identical build inputs restores the archive instead of building.
- **Output commits.** At the start of `lifecycle_verification`, before bridge or publication planning, the worker commits settled reviewed outputs as `docs: apply reviewed background knowledge` with author `Lervo Knowledge`. It selects only these dirty paths:
  - Integrated drafts whose replaced preimage is committed.
  - Current reviewed normalization outputs and records whose source is committed, or is such an integrated draft.
  - Superseded records of those sources.
- **Commit safety.** The worker commits only on a branch with no merge, rebase, cherry-pick, revert, bisect, or index lock. It uses `git commit --only`, so other staged or unstaged developer work is not committed. A concurrent Git failure skips the commit, and the next cycle retries.
- **HEAD fence.** The stage fence accepts a `HEAD` move only when the stage receipt names the commit and its parent is the observed `HEAD`. All captured source bytes still must match. Publication and bridges are then planned for the post-commit `HEAD`, and `current` records the post-commit snapshot.

## Failure and privacy

This decision adds no event type or failure code. The stage receipt records the commit coordinates and committed paths privately. Build archives contain only build outputs and stay in the local Git directory. Missing or mismatched archives fall back to an ordinary build.

## Verification

Focused tests must show the following:

- Documentation edits reuse a recorded build, and source edits rebuild.
- A worktree restores only an archive with identical inputs.
- A worker cycle commits integrated outputs, leaves developer staged and unstaged work untouched, and ends with `baselineCurrent` without another cycle.
- Selection follows committed preimage, integrated draft, and normalization chains, and refuses chains that start from uncommitted bytes.

Installed verification must show reused verification preparation and a clean working tree after `current`.

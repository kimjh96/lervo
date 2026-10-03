# ADR-0450: Keep background knowledge out of the developer flow

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0449](0449-synchronize-integration-target-with-working-branch.md), and [ADR-0357](../../../execution/verification/0357-prepare-isolated-candidate-verification-workspaces.md)

## Context

After ADR-0446 through ADR-0449, Mac convergence reached `current` and followed each new commit. Two developer costs remained:

- **Repeated builds.** Every `repository.default.v9` run began with `pnpm build`, taking 170–330 seconds under load and 60–70% of runtime. A documentation-only cycle could run the suite five times, rebuilding unchanged code and rewriting `dist` in the developer's working tree. Integration worktrees always built from scratch.
- **Uncommitted outputs.** Reviewed normalization rewrites, their records, and integrated drafts remained in the working tree, prompting unexplained-change investigations and cleanup commits; five followed one day of convergence. A commit after `current` moved `HEAD`, staled HEAD-bound publication and instruction bridges, and triggered another lifecycle cycle.

## Decision

- **Build reuse.** Verification preparation digests exact build-input bytes from tracked and untracked nonignored files, excluding Markdown, `docs/`, `.lervo/`, `.changes/`, and `*.tsbuildinfo`. It skips the build only when a recorded successful build has the same digest and its CLI, Node, and Hub bundles exist.
- **Shared build archives.** Archive successful builds by digest under the Git common directory, retaining the two newest archives. A worktree with identical build inputs restores the archive instead of building.
- **Current integration base.** Every canonical integration first synchronizes the integration ref with `HEAD` under the ADR-0449 safety rule, not only after a preimage mismatch. Drafts are then verified on the reviewed working-branch code, with the same build inputs as the main checkout. Installed worktrees previously built a stale tree for 288-345 seconds.
- **Output commits.** At the start of `lifecycle_verification`, before bridge or publication planning, the worker commits settled reviewed outputs as `docs: apply reviewed background knowledge`, authored by `Lervo Knowledge`. Select only these dirty paths:
  - Integrated drafts whose replaced preimage is committed.
  - Current reviewed normalization outputs and records whose source is committed or is such an integrated draft.
  - Superseded records of those sources.
- **Commit safety.** Commit only on a branch with no merge, rebase, cherry-pick, revert, bisect, or index lock. Use `git commit --only` to exclude other staged or unstaged developer work. A concurrent Git failure skips the commit; the next cycle retries.
- **HEAD fence.** Accept a `HEAD` move only when the stage receipt names the commit and its parent is the observed `HEAD`. All captured source bytes must still match. Plan publication and bridges for the post-commit `HEAD`; `current` records the post-commit snapshot.

## Failure and privacy

This decision adds no event type or failure code. The stage receipt privately records commit coordinates and committed paths. Build archives contain only build outputs and remain in the local Git directory. Missing or mismatched archives fall back to an ordinary build.

## Verification

Focused tests must show:

- Documentation edits reuse a recorded build; source edits rebuild.
- A worktree restores only an archive with identical inputs.
- A worker cycle commits integrated outputs, leaves developer staged and unstaged work untouched, and ends with `baselineCurrent` without another cycle.
- Selection follows committed preimage, integrated draft, and normalization chains, refusing chains that start from uncommitted bytes.

Installed verification must show reused verification preparation and a clean working tree after `current`.

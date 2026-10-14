# ADR-0521: Judge convergence verification on the bytes Git keeps

Status: `accepted`
Decision date: 2026-10-14
Amends: [ADR-0482](0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)

## Context

ADR-0482 fails a convergence stage with `knowledge_verification_modified_sources` when a pinned verification suite changes the isolated workspace while it runs. The before and after observations came from the orchestrator's repository snapshot. That snapshot walks the file system and excludes only a fixed list of directory names, such as `node_modules` and `dist`. It does not consult Git's ignore rules.

flemo's `gate` suite runs `bunx turbo run typecheck lint test build`. On 2026-10-14 at 10:32 UTC, its canonical integration failed again. This time the host's pnpm no longer rewrote `pnpm-lock.yaml`. The 18 changed paths were:

- 17 files of Husky's generated `.husky/_/` hook directory, which carries its own `.gitignore` of `*`;
- `apps/web/tsconfig.tsbuildinfo`, which flemo's `.gitignore` ignores with `*.tsbuildinfo`.

Git ignores every one of these paths, so the suite had changed no repository byte. Every gate that builds therefore failed convergence verification.

ADR-0510 already scans only what Git would keep for source intake, for the same reason.

## Decision

- Convergence verification observes the workspace through `captureGitKeptSnapshot`. It takes the orchestrator snapshot, drops untracked paths that Git ignores, and binds the exact `HEAD`. Tracked files always count, even when an ignore pattern matches them.
- The same observation fences the worker's verification and the integrator's candidate verification, before and after each suite and inside the runner.
- `observeGitIgnoredPaths` from ADR-0510 is exported and reused. Outside a Git work tree, or when Git cannot answer, nothing is ignored, and the observation is as strict as before.

## Consequences

A suite that writes ignored build output, such as incremental TypeScript state, Husky hooks, or caches, no longer fails convergence. A suite that changes a tracked file or a kept untracked file still fails with `knowledge_verification_modified_sources`, and the changed paths it reports exclude ignored files. A suite that commits also fails, because `HEAD` is part of the observation.

The ADR-0482 pnpm lockfile rewrite in flemo was a host defect. WSL's global pnpm 11.18.0 switched itself to `pnpm@12.9.1` and recorded `@pnpm/exe` as a package-manager dependency. Running pnpm 12.9.1 globally removes it; this decision does not mask tracked changes.

No event type or state is added.

## Verification

A unit test covers the snapshot against these changes:

- an ignored `*.tsbuildinfo` file and Husky's self-ignoring directory do not change it;
- an untracked kept file, a changed tracked file, and a new commit each do.

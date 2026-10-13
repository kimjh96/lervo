# ADR-0510: Scan only what Git would keep, and never read environment files

Status: `accepted`
Decision date: 2026-10-13
Amends: [ADR-0433](../canonicalization/0433-own-background-knowledge-for-every-repository-change.md)

## Context

The argo repository's knowledge and Node upgrade stages had been blocked for days with `knowledge_source_limit_exceeded: Read source bytes exceed the policy limit.` Its repository knowledge is small: Git tracks about 1 MiB and the source directories hold about 3 MiB. The repository scanner walked the whole filesystem and applied only the policy's exclude patterns. Those excluded `.venv/` and `venv/` but not `.venv-next/`, a Git-ignored Python virtual environment of 196 MiB in 19,454 files. That one directory exceeded the 64 MiB read budget.

ADR-0433 already drops Git-ignored untracked paths from change review because they carry no repository knowledge. The scanner did not follow that rule.

A comparison against the previous scanner on six local repositories found these Git-ignored paths read as sources:

- `.claude` lock files and agent worktrees;
- `tsbuildinfo` build outputs;
- Husky's generated hooks;
- the ignored publication root `docs/knowledge/`;
- `.env.local` files in plen and shiflo.

Environment files reached the scan because the secret-candidate pattern `\.env(?:\.|$)` was followed by a closing `$`. It therefore matched `.env` but not `.env.local` or `.env.production`. A value check against every Lervo state, data, knowledge, and publication file on the Mac and on the WSL host found no environment value. Only the paths had been recorded.

## Decision

- The scanner skips untracked paths that Git ignores. `observeGitIgnoredPaths` runs `git status --porcelain=v2 --ignored=matching --untracked-files=all` once per scan, so an ignored directory is reported once and never walked. Tracked files that match an ignore pattern remain sources. Paths are made relative to the scanned root even when that root is below the work-tree top. Outside a Git work tree, or when Git cannot answer, the scan reads the tree as before.
- `.env` and every `.env.*` variant are secret candidates whose bytes are never read. Explicit templates (`.example`, `.sample`, `.template`, `.dist`) stay ordinary sources.
- The 64 MiB, 20,000-file, and 1 MiB-per-file limits stay unchanged. They bound memory and time for a scan; the fix keeps non-repository content from counting against them.

## Consequences

argo now scans 282 sources and 1.4 MiB in about 120 ms, so its knowledge and Node upgrade stages can proceed. Other repositories lose only the Git-ignored entries listed above, so their next knowledge cycle sees a smaller inventory. A file that should be knowledge but is Git-ignored must be tracked, or the ignore rule changed.

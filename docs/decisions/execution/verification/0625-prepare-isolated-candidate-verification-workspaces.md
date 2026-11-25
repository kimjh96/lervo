# ADR-0625: Prepare isolated candidate verification workspaces

- Status: `accepted`
- Decision date: 2026-09-28
- Amended by: [ADR-0450](../../knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)

## Context

The version-eight repository suite passed lint in an installed canonical candidate worktree but failed type checking because the detached worktree lacked workspace dependency links and built package declarations. The source root had these ignored local artifacts; Git worktree provisioning intentionally did not copy them. The candidate never reached its runtime shards.

## Decision

Keep version eight immutable. Version nine adds one bounded preparation command before the unchanged lint, typecheck, and four runtime shards. In an isolated Git worktree, preparation installs the frozen dependency graph from the local pnpm store without network access, then builds that worktree's packages, subject to the conditional reuse described below. The primary checkout retains its installed dependencies and built artifacts.

Preparation fails on missing offline packages, installation errors, build errors, or its 30-minute outer limit. It grants no provider or document-writing authority.

An exact reviewed delegation must bind the new suite hash. The integration ref must contain the repository source, scripts, and lockfile under test: dependency preparation cannot make an old base commit represent the current working tree.

## Verification and limits

The installed candidate's offline frozen install succeeded from the local store. Its build and the version-nine installed integration and normalization results must be observed separately. A primary-checkout quality result does not establish a passing isolated candidate.

## Responsibility review

The preparation script owns only isolated workspace dependency preparation and build. The suite file orders the existing checks after that command. Neither module changes the verification result contract or candidate integration authority.

## Current preparation implementation: conditional build reuse

`scripts/distribution/prepare-isolated-verification-workspace.mjs` may reuse a recorded build. It inspects `.git` in the current working directory:

- If `.git` is a file, run `pnpm install --frozen-lockfile --offline` with a 300,000-millisecond child timeout before assessing reuse.
- Otherwise, skip installation.
- A missing `.git` fails during inspection.

The script then computes the build-input digest. Reuse requires all three paths to exist:

- `apps/cli/dist/bin.js`
- `apps/node-runtime/dist/bin.js`
- `apps/hub-runtime/dist/bin.js`

On a cache miss, it runs `pnpm build` with a 1,200,000-millisecond child timeout and records the marker only after a zero exit status. Spawn errors and nonzero or absent exit statuses throw. Child limits are separate from the suite's 30-minute outer limit. The script does not clean up or roll back partial build outputs.

### Input digest and marker

`scripts/distribution/lib/verification-build-cache.mjs` owns input selection, digest construction, and marker access. Git enumerates tracked and untracked nonignored paths. The helper excludes paths ending in `.md` or `.tsbuildinfo` and paths under `docs/`, `.lervo/`, or `.changes/`. These implementation exclusions do not independently prove that every excluded file can never affect a build.

The digest binds `process.version` and sorted, deduplicated path/content-hash pairs. Ordinary files contribute exact working-tree bytes. Symbolic links contribute `link:` followed by the link target text, not dereferenced target bytes. Paths missing at read time are skipped; other read errors propagate. The digest does not independently inventory ignored local dependencies or artifacts.

The helper writes `node_modules/.cache/lervo/verification-build.json` with `schemaVersion: 1` and `inputDigest`. Reuse requires the marker, existence of every requested output, and a parsed marker with a matching `inputDigest`. Marker read or parse failure returns a cache miss. The reader neither validates `schemaVersion` nor hashes output contents.

### Evidence boundary and fixture scope

A reuse message establishes only that the marker and existence checks passed. It does not prove unchanged output bytes, deterministic builds, a complete generated-output set, or a successful isolated verification suite. The source comment asserting that identical inputs cannot change outputs exceeds what these checks establish.

`scripts/distribution/test/verification-build-cache.test.mjs` contains fixtures for:

- Source and lockfile inclusion.
- Documentation and private-state exclusion.
- Rejection before recording a marker.
- Reuse after a documentation edit.
- Rejection of a missing required output.
- Invalidation after a source edit.

The supplied file contains no execution receipt. It does not test malformed markers, symlink behavior, output tampering, child-process timeouts, or installed suite acceptance. Those results must be observed separately before making corresponding verification claims.

## References

- [ADR-0624](0624-bound-test-deadlines-for-busy-host-shards.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)

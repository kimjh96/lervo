# ADR-0357: Prepare isolated candidate verification workspaces

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The version-eight repository suite passed lint in an installed canonical candidate worktree, then failed type checking because that detached worktree had no workspace dependency links or built package declarations. The source root had those ignored local artifacts, but Git worktree provisioning intentionally did not copy them. The candidate therefore did not reach its runtime shards.

## Decision

Keep version eight immutable. Version nine adds one bounded preparation command before its unchanged lint, typecheck, and four runtime shards. In an isolated Git worktree, preparation installs the frozen dependency graph from the local pnpm store without network access, then builds that worktree's packages. The existing primary checkout keeps its installed dependencies and built artifacts. The command fails on missing offline packages, installation errors, build errors, or its 30-minute outer limit. It grants no provider or document-writing authority.

An exact reviewed delegation must bind the new suite hash. The integration ref must also contain the repository source, scripts, and lockfile under test; dependency preparation alone cannot make an old base commit represent the current working tree.

## Verification and limits

The installed candidate's offline frozen install succeeded from the local store. Its build and the version-nine installed integration and normalization results must be observed separately. A passing isolated candidate cannot be inferred from a primary-checkout quality result.

## Responsibility review

The new preparation script owns only isolated workspace dependency preparation and build. The suite file orders the existing checks after that command. Neither module changes the verification result contract or candidate integration authority.

## References

- [ADR-0356](0356-bound-test-deadlines-for-busy-host-shards.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)

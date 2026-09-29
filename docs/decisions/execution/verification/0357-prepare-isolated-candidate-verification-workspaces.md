# ADR-0357: Prepare isolated candidate verification workspaces

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The version-eight repository suite passed lint in an installed canonical candidate worktree but failed type checking because the detached worktree lacked workspace dependency links and built package declarations. The source root had these ignored local artifacts; Git worktree provisioning intentionally did not copy them. The candidate never reached its runtime shards.

## Decision

Keep version eight immutable. Version nine adds one bounded preparation command before the unchanged lint, typecheck, and four runtime shards. In an isolated Git worktree, preparation installs the frozen dependency graph from the local pnpm store without network access, then builds that worktree's packages. The primary checkout retains its installed dependencies and built artifacts.

Preparation fails on missing offline packages, installation errors, build errors, or its 30-minute outer limit. It grants no provider or document-writing authority.

An exact reviewed delegation must bind the new suite hash. The integration ref must contain the repository source, scripts, and lockfile under test: dependency preparation alone cannot make an old base commit represent the current working tree.

## Verification and limits

The installed candidate's offline frozen install succeeded from the local store. Its build and the version-nine installed integration and normalization results must be observed separately. A primary-checkout quality result does not establish a passing isolated candidate.

## Responsibility review

The preparation script owns only isolated workspace dependency preparation and build. The suite file orders the existing checks after that command. Neither module changes the verification result contract or candidate integration authority.

## References

- [ADR-0356](0356-bound-test-deadlines-for-busy-host-shards.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)

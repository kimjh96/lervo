# ADR-0130: Integrate Stage Approval into Publication Transition

- Status: accepted
- Decision date: 2026-08-21

## Context

public_release_confirmed is public-result evidence, but the transition union previously understood only direct execution and reviewed resolution. A separate completion state would split bootstrap consumption and permanent Trusted Publisher gates.

## Decision

stage_approval_reconciliation becomes a third exact-key union member. It recomputes reconciliation report, stage review, human decision, approval authorization, immutable attempt, and terminal. It binds the review's publication-authorization digest to the original authorization and repository, source commit, package, version, registry, tag, and artifact to the bootstrap. Only confirmed outcomes qualify.

Stage review advances to v2 to add this upstream binding. V1 remains readable but cannot authorize approval or transition. Stage transition still requires fresh public release, stage-only workflow, exact npm createStagedPackage trust, and GitHub environment. Direct arming is neither required nor recorded for this path.

Existing v2 receipt meanings remain unchanged: execution and resolution stay v2; stage evidence creates v3 only. Stage in v2 and legacy types in v3 are rejected. All paths converge only on consumed bootstrap, stage-only Trusted Publisher, and forbidden direct publish while retaining provenance.

## Consequences

Tests cover confirmed evidence, original authorization/bootstrap binding, absent direct arming, v3 compatibility, invalid combinations, unconfirmed reports, and both v2 regressions.

# ADR-0242: Refine the search-rollout decision route

Status: `accepted`

## Context

The `docs/decisions/search` leaf reached its reviewed 24-decision limit and failed closed when the v4 retrieval evaluation added another decision. Raising the limit would conceal a semantic split: core retrieval and grounding decisions change independently from operational rollout review, status, action, preflight, and doctor contracts.

## Decision

Add the repository-scoped `search.rollout` route at `docs/decisions/search/rollout` with the exact title term `search rollout`. Move ADR-0065 through ADR-0071 together because they define the bounded search-rollout lifecycle from human review through status, explicit action, write-free preflight, and operational diagnostics.

Keep search engines, candidate evaluation, selection, and natural-language retrieval experiments in `docs/decisions/search`. Preserve ADR identity and bytes through exact-hash structure-move plans, and update every repository reference in the same reviewed operations. Do not change the 24-document leaf bound.

When an exact structure move finds one current single-output normalization record owned by the source path, relocate that record to the destination in the same durable transaction. Preserve its record ID, candidate ID, reviewed hashes, and compiler provenance. Fail closed when a normalization family has multiple outputs because a byte-preserving move cannot determine how to remap a split family.

## Consequences

The search decision tree has two cohesive bounded leaves, and the new directory begins with seven artifacts. Migration and lint continue to reject unknown routes and future overflow. Exact moves no longer leave current normalization ownership at a stale source path. Regression coverage verifies both relocation and split-family rejection.

This refinement introduces no archive, date bucket, catch-all path, or automatic classification of existing grouped decisions.

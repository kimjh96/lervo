# ADR-0071: Doctor checks for search-rollout operational sources

Status: `accepted`
Decision date: 2026-08-20

## Context

Engine selections, three policy kinds, reviews, and actions form linked immutable sources. Individual commands explain requested slices but project-wide doctor did not verify their complete relationships. Downstream checks cannot appear healthy when prerequisites are unreadable.

## Decision

- Add `search_engine_selection`, `search_rollout_policies`, `search_rollout_reviews`, and `search_rollout_actions` checks.
- Selection and policies check independently; reviews require both healthy; actions require selection, policies, and reviews healthy.
- Safely empty source is `healthy` with count zero. Direct corruption/missing linkage is `unhealthy`; unavailable prerequisite makes dependent check `unknown`, never empty healthy.
- Selection uses the operational resolver's full chain/policy/replay validation. Policy checks engine/review/action policies and bindings. Review/action checks reuse bounded status readers, including off-page validation.
- Doctor selects no engine/latest review/action and writes no acknowledgement, transition, policy, event, or Hub source.
- Issues use fixed English messages/codes and exclude queries/digests/source IDs/paths/bodies/results/credentials/absolute paths/internal errors.

## Consequences

Project diagnostics distinguish corrupted from uncheckable rollout state without replacing quality evaluation, approval, preflight, or execution.

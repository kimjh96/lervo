# ADR-0071: Doctor checks for search-rollout operational sources

Status: `accepted`  
Decision date: 2026-08-20

## Context

Engine selections, three policy kinds, reviews, and actions form linked immutable sources. Individual commands explain requested slices, but the project-wide doctor did not verify their complete relationships. A downstream check must not appear healthy when its prerequisites are unreadable.

## Decision

- Add `search_engine_selection`, `search_rollout_policies`, `search_rollout_reviews`, and `search_rollout_actions` checks.
- Check selection and policies independently. Reviews require both to be healthy; actions require selection, policies, and reviews to be healthy.
- Report a safely empty source as `healthy` with count zero. Report direct corruption or missing linkage as `unhealthy`. Report a dependent check with an unavailable prerequisite as `unknown`, never empty healthy.
- Validate selection through the operational resolver's complete chain, policy, and replay checks.
- Validate engine, review, and action policies and their bindings in the policy check.
- Reuse bounded status readers for review and action checks, including off-page validation.
- The doctor selects no engine, latest review, or action, and writes no acknowledgement, transition, policy, event, or Hub source.
- Issues use fixed English messages and codes. Exclude queries, digests, source IDs, paths, bodies, results, credentials, absolute paths, and internal errors.

## Consequences

Project diagnostics distinguish corrupted rollout state from state that cannot be checked, without replacing quality evaluation, approval, preflight, or execution.

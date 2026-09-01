# ADR-0328: Make qualified Lexical v2 the product default

Status: `accepted`  
Date: 2026-09-01

## Context

ADR-0321 activated the provider-projection, Lexical v2, and deterministic-fusion plan in Lervo through a repository-local bundle bound to the complete current Markdown corpus and project coordinate. Repositories without that bundle retained the implicit Lexical v1 baseline after upgrading to the same CLI.

This confused product qualification with repository experimentation. The v20 engine evidence and complete-plan evidence qualified deterministic shipped behavior and exact adapter builds. Repeating provider comparison in every repository protected no repository-owned fact or authority, prevented qualified behavior from becoming the product default, and made ordinary upgrades inconsistent across repositories.

## Decision

Promote the qualified Lexical v2 engine and complete projected retrieval plan to the shipped product default. Qualification `spqual_999f55bdaa9336fb6733d2ba` binds:

- Lexical v2 adapter build `sebuild_e9f2ac9398b0f58d03143e7a`.
- The exact Codex and Claude projector builds admitted by production.
- Independent projected-query execution, `query_coverage_interleave` fusion, bounded limits, fail-closed behavior, and privacy exclusions.
- The accepted v20 evidence hash and this decision.

An initialized repository without explicit local selection uses Lexical v2 for operational search and the complete projected Lexical v2 plan for direct terminal retrieval. Runtime builds the index from the current bounded registered corpus. The corpus need not match the qualification corpus because qualification establishes shipped behavior, not the truth, relevance, or contents of future repositories. Every use revalidates current paths, hashes, limits, projector coordinates, engine identity, and adapter build.

Explicit local selection history remains authoritative. A recorded Lexical v1 baseline continues to select v1; another reviewed candidate continues through its repository-bound evidence. A legacy activation of the exact product-default plan resolves as the product default and no longer pins ordinary retrieval to the historical repository corpus.

Product-default search attempts add `productQualificationId`. It is mutually exclusive with `selectionTransitionId`, contains no query or source bytes, and indicates that shipped qualification selected the engine. Recommendation evidence may carry the same optional coordinate. Its absence from historical records means only that the older contract did not record product qualification.

A missing or changed default engine, adapter, projector, response, corpus read, or fusion stage fails closed, with no silent Lexical v1 fallback. Installing an older reviewed CLI release is the release-level rollback; existing repository-local baseline transitions remain valid. The default grants no Hub, external-source, network, credential, publication, or effect authority.

## Consequences

All repositories running the new CLI receive the same qualified default without project-specific evaluation files. Repository-specific activation remains available for a genuinely different engine or complete plan. Status distinguishes `product_default`, local candidate, recorded baseline, and product qualification from transition evidence.

The compatibility activation chain remains available for repository experiments and explicit recorded selections but no longer defines no-transition behavior. Quality reporting separates product-qualified observations from implicit and recorded Lexical v1 observations.

## Verification

- Test pure qualification and production-projector identity.
- Resolve the operational engine without repository activation.
- Resolve the retrieval plan against a current, unpinned repository corpus.
- Test product-qualified attempts, recommendations, event redaction, and quality reports.
- Check CLI status and real searches in repositories with and without legacy plan history.
- Run full quality, documentation, build, release-completion, packed-release, and repository-upgrade checks.

## References

- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Projected-plan qualification](0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [V20 qualification evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)

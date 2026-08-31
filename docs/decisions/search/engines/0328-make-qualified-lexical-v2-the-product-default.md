# ADR-0328: Make qualified Lexical v2 the product default

Status: `accepted`  
Date: 2026-09-01

## Context

ADR-0321 activated the provider-projection, Lexical v2, and deterministic-fusion plan in the
Lervo repository through a repository-local bundle. The bundle bound the complete current Lervo
Markdown corpus and project coordinate. Other repositories upgraded to the same CLI but retained
the implicit Lexical v1 baseline because they had no local activation bundle.

That boundary confused product qualification with repository experimentation. The v20 engine
evidence and the later complete-plan evidence qualified shipped deterministic behavior and exact
adapter builds. Requiring every repository to repeat the provider comparison did not protect a
repository-owned fact or authority. It prevented the qualified product behavior from becoming the
product default and made an ordinary upgrade observably inconsistent across repositories.

## Decision

Promote the qualified Lexical v2 engine and complete projected retrieval plan to the shipped
product default. The default qualification is content-bound as
`spqual_999f55bdaa9336fb6733d2ba` and binds:

- Lexical v2 adapter build `sebuild_e9f2ac9398b0f58d03143e7a`.
- The exact Codex and Claude projector builds admitted by the production runtime.
- Independent projected-query execution, `query_coverage_interleave` fusion, bounded limits,
  fail-closed behavior, and privacy exclusions.
- The accepted v20 evidence hash and this product-default decision.

An initialized repository with no explicit local selection now uses Lexical v2 for operational
search and the complete projected Lexical v2 plan for direct terminal retrieval. Runtime builds the
index from the current bounded registered corpus. It does not require the current corpus to equal
the corpus used to qualify the algorithm because qualification establishes shipped behavior, not
the truth, relevance, or contents of every future repository. Current paths, hashes, limits,
projector coordinates, engine identity, and adapter build remain revalidated on every use.

Existing explicit local selection history remains authoritative. A recorded Lexical v1 baseline
continues to select v1, and a different reviewed candidate continues through its existing
repository-bound evidence. A legacy activation of the exact product-default plan resolves as the
product default and no longer pins ordinary retrieval to the historical repository corpus.

Product-default search attempts add `productQualificationId`. It is mutually exclusive with
`selectionTransitionId`, contains no query or source bytes, and means the shipped qualification
selected the engine. Recommendation evidence may carry the same optional coordinate. Its absence
on historical records means only that the older contract did not record a product qualification.

Any missing or changed default engine, adapter, projector, response, corpus read, or fusion stage
fails closed. There is no silent Lexical v1 fallback. Installing an older reviewed CLI release is
the release-level rollback; existing repository-local baseline transitions remain valid. The
default adds no Hub, external source, network, credential, publication, or effect authority.

## Consequences

All repositories running the new CLI obtain the same qualified default without creating or copying
project-specific evaluation files. Repository-specific activation remains available for a genuinely
different engine or complete plan. Status distinguishes `product_default`, local candidate,
recorded baseline, and product qualification from transition evidence.

The compatibility activation chain remains useful for repository experiments and explicit recorded
selections, but it no longer defines the no-transition product behavior. Search quality reporting
keeps product-qualified observations separate from implicit and recorded Lexical v1 observations.

## Verification

- Pure qualification and production-projector identity tests.
- Operational engine resolution without repository activation.
- Retrieval-plan resolution on a current unpinned repository corpus.
- Product-qualified attempt, recommendation, event-redaction, and quality-report tests.
- CLI status and real search checks in repositories with and without legacy plan history.
- Full quality, documentation, build, release-completion, packed release, and repository-upgrade
  checks.

## References

- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Projected-plan qualification](0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [V20 qualification evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)

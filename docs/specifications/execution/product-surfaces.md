# Product surfaces

Status: `active`
As of: 2026-09-16

Lervo provides a Discord-visible reference product now and a first-party surface later. Both compose the same headless application contracts and preserve local repository authority.

## Contract topics

- [Architecture and ownership](product-surfaces/architecture-and-ownership.md): layers, dependency direction, state ownership, extension ports, and module-split requirements.
- [Discord and host acceptance](product-surfaces/discord-and-host-acceptance.md): current installed experience, feature projections, shared host conformance, and completion meaning.
- [Application projections](product-surfaces/application-projections.md): exact activity, unified search, observability, steering, subscription, privacy, and failure contracts.
- [Deliberation integration](product-surfaces/deliberation.md): formal decision-workflow scope, origin and participant binding, budgets, search, canonicalization, and evolution.
- [Search, knowledge, and compatibility](product-surfaces/search-knowledge-and-compatibility.md): Lexical v2, multi-corpus search, canonicalization, version evolution, migration, and rollback.
- [Surface observability](product-surfaces/observability.md): existing document coverage and evidence, resource, token, cache, stage, result, completeness, and comparison meanings across hosts.

## Product boundary

A product surface may render, cache bounded presentation state, collect user intent, and invoke authorized application commands. It cannot become the authority for repositories, work, conversations, knowledge, approvals, verification, or completion.

Discord is the current installed acceptance surface. A future first-party interface may provide richer presentation but must replay the same durable identities, work, context, evidence, and source coordinates through the same contract suite.

## References

- [ADR-0417](../../decisions/execution/applications/0417-own-discord-visible-reference-product.md)
- [ADR-0418](../../decisions/execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md)
- [Product-host protocol](product-host-protocol.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)

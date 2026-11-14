# Search and context boundaries

Status: `active`
As of: 2026-09-16

Search separates recommendation, engine execution, plan composition, and context delivery:

- [Evidence boundary](search-and-context/evidence.md)
- [Engine boundary and qualification](search-and-context/engines.md)
- [V2 composition and operational resolution](search-and-context/composition.md)
- [Linked-context disposition](search-and-context/linked-context.md)

[Proposed cross-surface context quality](../specifications/execution/context-quality.md) separates applicable obligations from ranked evidence and assigns shared planning, exact section delivery, and verification to existing owners. [ADR-0501](../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) and its delivery roadmap distinguish active preparation observations and applied owner-rule delivery from remaining full-plan and installed acceptance work.

## Decisions

- [Lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md)
- [Recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md)
- [Engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md)
- [Operational resolution](../decisions/search/0061-fail-closed-operational-search-engine-resolution.md)
- [Adapter build identity](../decisions/search/0063-search-adapter-build-identity-and-replay-receipt.md)
- [Linked-default retirement](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
- [Replacement and composition](../decisions/search/engines/0306-separate-search-engine-replacement-and-composition.md)
- [Lexical-v2 evaluation disposition](../decisions/search/engines/0307-revise-lexical-v2-after-local-and-provider-evaluation.md)
- [Lexical-v2 v12 confirmation disposition](../decisions/search/engines/0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [Lexical-v2 v20 engineering qualification](../decisions/search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Reviewed real-use disposition](../decisions/search/engines/0319-keep-lexical-v2-inactive-after-reviewed-real-use-gate.md)
- [Projected-plan qualification](../decisions/search/engines/0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [Retrieval-plan activation](../decisions/search/engines/0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Product-default Lexical v2](../decisions/search/engines/0328-make-qualified-lexical-v2-the-product-default.md)
- [Product-default surface convergence](../decisions/search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)
- [Direct terminal query projection](../decisions/execution/providers/hooks/0353-remove-redundant-terminal-query-admission.md)

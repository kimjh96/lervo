# Authority, assessment, and integration

## Responsibilities

The repository-knowledge domain owns pure debt selection, obligation identity, stage transitions, completion predicates, and failure classification. Orchestration sequences these policies through ports. Persistence owns atomic events, outbox leases, and recovery. Provider adapters own invocation, model configuration, usage, and normalized provider failures. CLI and Node compose the same owner and render the same status.

Separate baseline discovery, semantic source capture, canonical assessment, normalization review, document integration, lifecycle reconciliation, and outcome settlement into cohesive modules. Reuse the richer source/context and workspace boundaries without adding native provider branches or policies to the current worker facade.

## Contracts

- [Authority and independent review](authority-and-integration/authority-and-review.md)
- [Source and semantic assessment](authority-and-integration/source-and-assessment.md)
- [Scoped writes and integration](authority-and-integration/scoped-writes-and-integration.md)

## References

- [ADR-0359: Renew assignment leases during long verification](../../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md)
- [ADR-0443: Load linked child contracts for canonical review](../../../decisions/knowledge/repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md)
- [ADR-0438: Bind bounded asset manifests to delegation](../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md)

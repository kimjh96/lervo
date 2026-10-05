# Reviewed background output commits

This specification records implementation boundaries in `packages/repository-knowledge-runtime/src/canonical-disposition-ledger.ts`, `canonical-target-preflight.ts`, `effect-source-fence.ts`, `knowledge-output-commit.ts`, `settled-output-boundary.ts`, and `lifecycle-final.ts`. [ADR-0450](../../../decisions/knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) records the decision, and [ADR-0465](../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md) moves the commit to batch boundaries. Source inspection is neither an execution receipt nor installed acceptance.

## Implementation boundaries

- [Integrated draft evidence](reviewed-output-commits/integrated-draft-evidence.md): ledger validation, filtering, and caching.
- [Integration preflight](reviewed-output-commits/integration-preflight.md): target synchronization, delegation, and preimage checks.
- [Output selection and Git mutation](reviewed-output-commits/output-selection-and-git-mutation.md): eligible paths, commit behavior, and failure limits.
- [Snapshot advancement](reviewed-output-commits/snapshot-advancement.md): accepted source and HEAD changes.
- [Lifecycle ordering and settlement](reviewed-output-commits/lifecycle-ordering-and-settlement.md): batch-boundary and lifecycle commit receipts, later planning, and final settlement.

## Verification boundary

The supplied files contain implementation, not test execution or installed receipts. Acceptance must separately establish safe selection over committed preimages, preservation of unrelated staged and unstaged work, failure recovery after staging, concurrent-edit behavior, correct post-commit snapshot advancement, and eventual current settlement. Shared build archive restoration and retention are outside these five modules and are not verified here.

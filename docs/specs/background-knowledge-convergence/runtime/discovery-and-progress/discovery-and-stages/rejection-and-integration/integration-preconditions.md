# Integration preconditions

Before acquiring a canonical writer lease, the runtime compares every reviewed target preimage with the selected Git integration ref. Only exact, canonically settled normalization lineage can explain an owned preimage change.

Before recording a mismatch, the runtime attempts one synchronization of the integration ref with `HEAD`. It merges `HEAD` only when every ref-only change matches an integrated draft that reached root apply ([ADR-0449](../../../../../../decisions/knowledge/repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md)).

A delegation can name a host-local ref that this host never created. Synchronization starts an absent ref at `HEAD` with a create-only ref update. If the ref remains unresolved, the stage records `attention_required/knowledge_integration_target_unavailable` until the delegated ref exists ([ADR-0472](../../../../../../decisions/knowledge/documents/0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)).

When the ref is not synchronized, the runtime checks whether a squash merge absorbed it. Every ref-only path must be byte-equal at `HEAD`, changed by a base-side commit, or committed only by Lervo and never adopted. At least one path must have been decided by the base. The runtime then preserves the old tip under `refs/lervo/knowledge-integration-absorbed/`, moves the Lervo-only ref to `HEAD` with a compare-and-swap, and records `knowledge.integration_target.absorbed`. It never touches the working tree or a user branch ([ADR-0482](../../../../../../decisions/knowledge/semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)).

Other mismatches record `waiting_authority/canonical_target_diverged` with a private exact target-ref/commit dependency. Source or target-ref changes trigger reevaluation. Matching target bytes resume the existing review without another model call.

Unchanged drafts are invalid semantic changes and cannot start an empty Git integration.

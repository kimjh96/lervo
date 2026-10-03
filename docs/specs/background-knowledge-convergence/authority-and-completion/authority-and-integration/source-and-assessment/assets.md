# Asset verification

For non-text assets, retain exact hashes and typed asset/verification coordinates. Binary bytes must never enter a text reviewer. Exclude repository-governed build caches only under a tracked generated-source policy or observed Git ignore disposition; extensions and filename heuristics alone do not permit exclusion. Tracked assets remain obligations.

Partition mixed source units into text review and asset verification. The parent completes only when both dispositions are covered. Unsupported opaque semantics remain assigned for review without silently invalidating unrelated text review.

[ADR-0438](../../../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) binds an optional bounded asset sidecar through the exact reviewed delegation hash. Inline and sidecar dispositions preserve the same path/hash/kind, rationale, and pinned-suite contract. Their combined unique count must not exceed 1,024.

Preview and apply bind both authority files in one durable journal. Every authority check and outcome settlement rereads exact sidecar bytes. This representation creates no semantic review, asset promotion, source exclusion, additional tools, or provider allowance.

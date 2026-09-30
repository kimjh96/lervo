# Source and semantic assessment

## Source validation and context

Before reading source, validate the complete manifest schema, artifact digest and byte count, project and source-event identity, revision and path count, safe relative paths, and supported coordinate kinds. Resolve paths without escaping the repository through links. Recover committed before-bytes from pinned trees, not only the last four commits. Unavailable dirty before-bytes remain explicit evidence gaps.

Load the applicable instruction hierarchy and bounded canonical recommendations; read exact bytes and bind their hashes. Missing required instructions, invalid encodings, or excess input fail with bounded context reasons. Never truncate instructions or source to fit a provider request. Source paths and text remain in private review input, outside public events.

[ADR-0443](../../../../decisions/knowledge/repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md) adds at most four direct child Markdown contracts linked from selected canonical candidates after the eight ranked recommendations. The combined 12-document, 1-MiB context binds exact child hashes through the same settlement fence. Linked context provides independent-review evidence; it neither proves semantic coverage nor approves a draft.

## Assets

For non-text assets, retain exact hashes and typed asset/verification coordinates. Binary bytes never enter a text reviewer. Exclude repository-governed build caches only under a tracked generated-source policy or observed Git ignore disposition; extensions or filename heuristics alone grant no exclusion. Tracked assets remain obligations.

Mixed source units partition text review from asset verification. The parent completes only when both dispositions are covered. Unsupported opaque semantics remain assigned for review without silently invalidating unrelated text review.

[ADR-0438](../../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) binds an optional bounded asset sidecar through the exact reviewed delegation hash. Inline and sidecar dispositions preserve the same path/hash/kind, rationale, and pinned-suite contract; their combined unique count is at most 1,024.

Preview and apply bind both authority files in one durable journal. Every authority check and outcome settlement rereads exact sidecar bytes. This representation creates no semantic review, asset promotion, source exclusion, additional tools, or provider allowance.

## Assessment outcomes

Semantic assessment returns a source-bound no-durable-change rationale, verified coverage in exact canonical bytes, or a nonempty candidate naming compatible target responsibilities.

A `canonical_change_candidate` verdict without a target cannot become a null `pending_review` success. Existing canonical files do not prove semantic coverage. Such cases require a durable assessment/authority dependency with a bounded reason.

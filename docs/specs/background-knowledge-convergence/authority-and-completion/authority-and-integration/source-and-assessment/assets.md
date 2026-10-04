# Asset verification

For non-text assets, retain exact hashes and typed asset/verification coordinates. Binary bytes must never enter a text reviewer. Exclude repository-governed build caches only under a tracked generated-source policy or observed Git ignore disposition; extensions and filename heuristics alone do not permit exclusion. Tracked assets remain obligations.

Partition mixed source units into text review and asset verification. The parent completes only when both dispositions are covered. Unsupported opaque semantics remain assigned for review without silently invalidating unrelated text review.

[ADR-0438](../../../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) binds an optional bounded asset sidecar through the exact reviewed delegation hash. Inline and sidecar dispositions preserve the same path/hash/kind, rationale, and pinned-suite contract. Their combined unique count must not exceed 1,024.

Preview and apply bind both authority files in one durable journal. Every authority check and outcome settlement rereads exact sidecar bytes. This representation creates no semantic review, asset promotion, source exclusion, additional tools, or provider allowance.

## Baseline dispositions and unresolved assets

`unresolvedConvergenceAssets` revalidates the delegation against the baseline project, delegation hash, and provider before resolving asset declarations. It checks opaque baseline sources except those explicitly classified in `sourceDispositions` as `policy_excluded` or `sensitive_local`. This consumes baseline classification without authorizing new exclusions.

Sensitive source bytes remain unread. An explicit `sensitive_local` baseline disposition settles this asset gate without a content-hash asset declaration; it does not verify contents. Every remaining opaque source requires an `opaque_verified` declaration matching its exact path and content hash. A declaration for earlier bytes is insufficient.

An unresolved source produces `attention_required` with `asset_verification_required`. Its private schema-version-one `typed_asset_verification` dependency binds the snapshot hash, delegation hash, and unresolved source path/hash/kind coordinates. A null result means this gate found no unresolved eligible opaque assets; it does not establish semantic coverage, execution of pinned suites, or complete lifecycle currency.

`asset-manifest-plan.test.ts` specifies the sensitive-source distinction, declaration application, source drift, authority drift, stale-plan refusal, and rollback assertions. Test source alone does not establish an executed passing run or installed acceptance.

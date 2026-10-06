# Asset verification

For non-text assets, retain exact hashes and typed asset/verification coordinates. Binary bytes must never enter a text reviewer. Exclude repository-governed build caches only under a tracked generated-source policy or observed Git ignore disposition; extensions and filename heuristics alone do not permit exclusion. Tracked assets remain obligations.

Partition mixed source units into text review and asset verification. The parent completes only when both dispositions are covered. Unsupported opaque semantics remain assigned for review without silently invalidating unrelated text review.

[ADR-0438](../../../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) binds an optional bounded asset sidecar through the exact reviewed delegation hash. Inline and sidecar dispositions preserve the same path/hash/kind, rationale, and pinned-suite contract. Their combined unique count must not exceed 1,024.

Preview and apply bind both authority files in one durable journal. Every authority check and outcome settlement rereads exact sidecar bytes. This representation creates no semantic review, asset promotion, source exclusion, additional tools, or provider allowance.

## Baseline dispositions and unresolved assets

`unresolvedConvergenceAssets` revalidates the delegation against the baseline project, delegation hash, and provider before resolving asset declarations. It checks opaque baseline sources except those explicitly classified in `sourceDispositions` as `policy_excluded` or `sensitive_local`. This consumes baseline classification without authorizing new exclusions.

Sensitive source bytes remain unread. An explicit `sensitive_local` baseline disposition settles this asset gate without a content-hash asset declaration; it does not verify contents.

Under [ADR-0479](../../../../../decisions/knowledge/semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md), every remaining opaque source is settled at final lifecycle verification in one of two ways. It is declared when an `opaque_verified` declaration matches its exact path and content hash. Otherwise it is suite-bound, because its exact bytes belong to the captured revision on which every pinned delegation suite passed. A declaration for earlier bytes declares nothing, so changed bytes become suite-bound. A failing suite stops verification with `knowledge_verification_failed`.

The lifecycle proof records `assetSettlement` with the declared count, the suite-bound count and hash, and a private artifact. That artifact lists every suite-bound path and hash with the suite receipts. Suite binding establishes no visual quality, runtime promotion, or semantic coverage. Lifecycle verification no longer produces `asset_verification_required`. A pre-ADR `typed_asset_verification` stop is reevaluated once.

`asset-manifest-plan.test.ts` specifies the sensitive-source distinction, declared and suite-bound classification, declaration application, source drift, authority drift, stale-plan refusal, and rollback assertions. `convergence-parking.test.ts` specifies an undeclared asset reaching verified currency as suite-bound. Test source alone does not establish an executed passing run or installed acceptance.

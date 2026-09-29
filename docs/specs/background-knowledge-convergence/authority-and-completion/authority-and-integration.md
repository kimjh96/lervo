# Authority, assessment, and integration

## Responsibilities

The repository-knowledge domain owns pure debt selection, obligation identity, stage transitions, completion predicates, and failure classification. Orchestration sequences those policies through ports. Persistence owns atomic events, outbox leases, and recovery. Provider adapters own invocation, model configuration, usage, and normalized provider failures. CLI and Node compose the same owner and render the same status.

Split baseline discovery, semantic source capture, canonical assessment, normalization review, document integration, lifecycle reconciliation, and outcome settlement into cohesive modules. Reuse the richer source/context and workspace boundaries without adding native provider branches or policies to the current worker facade.

## Authority and independent review

A reviewed repository delegation binds project identity, active agent ancestry, role version and hashes, permitted canonical roots, permitted normalization scopes, capability and verification contracts, integration target, expiration or revocation, and resource ceilings. An empty or legacy delegation permits inspection only. This design creates no delegation for an installed project.

Long convergence stages retain their exact assignment lease through bounded renewal under [ADR-0359](../../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md). Renewal keeps the same claim generation, requires the current stage lease, and stops before assignment settlement; the generic 30-minute maximum is unchanged.

The coordinator registers each worker with its parent and claims a scoped assignment. A semantic reviewer has read-only authority, no exclusive write-path lease, and a physically isolated no-capability process. A writer receives a different narrow assignment and the ordinary workspace lease. Recommendations and role templates grant neither assignment nor write authority.

Normalization review is separate from generation, with a distinct durable reviewer identity and no shared provider session. Another provider is optional, must already be permitted, and gives no correctness guarantee. Review validates meaning, requirements, examples, links, lifecycle metadata, protected regions, skill identity, and resource bindings. Structural coverage alone is insufficient.

Each accepted item has an exact approval binding original source, candidate and output hashes, source-unit coverage, skill resources, compiler build, policy, language, format, reviewer assignment, verification, and current delegation. Rejected items retain a bounded reason and remain unapplied. Applying stored candidates never invokes the generator again. Conflict with user-owned material or a requested decision lacking authority creates one content-bound decision rather than repeated permission prompts or a silent rewrite.

This agent review requires the proposed ADR-0434 amendment to the existing semantic-approval policy. Existing approvals cannot imply standing delegation.

## Source and semantic assessment

Before reading source, validate the complete manifest schema, artifact digest and byte count, project and source-event identity, revision and path count, safe relative paths, and supported coordinate kinds. Resolve paths without escaping the repository through links. Recover committed before-bytes from pinned trees, not only the last four commits. Unavailable dirty before-bytes remain explicit evidence gaps.

Load the applicable instruction hierarchy and bounded canonical recommendations; read their exact bytes and bind their hashes. Missing required instructions, invalid encodings, or excess input fail with bounded context reasons. Never truncate instructions or source to fit a provider request. Source paths and text remain in private review input, outside public events.

[ADR-0443](../../../decisions/knowledge/repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md) adds at most four direct child Markdown contracts linked from selected canonical candidates after the eight ranked recommendations. The combined 12-document, 1-MiB context binds exact child hashes through the same settlement fence. Linked context supplies evidence for independent review; it does not prove semantic coverage or approve a draft.

For non-text assets, retain exact hashes and typed asset/verification coordinates. Binary bytes never enter a text reviewer. Exclude repository-governed build caches only under a tracked generated-source policy or observed Git ignore disposition; extensions or filename heuristics alone grant no exclusion. Tracked assets remain obligations. Mixed source units partition text review from asset verification; the parent completes only when both dispositions are covered. Unsupported opaque semantics remain assigned for review without silently invalidating unrelated text review.

[ADR-0438](../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) binds an optional bounded asset sidecar through the exact reviewed delegation hash. Inline and sidecar dispositions preserve the same path/hash/kind, rationale, and pinned-suite contract; their combined unique count is at most 1,024. Preview and apply bind both authority files in one durable journal. Every authority check and outcome settlement rereads exact sidecar bytes. This representation creates no semantic review, asset promotion, source exclusion, additional tools, or provider allowance.

Semantic assessment returns a source-bound no-durable-change rationale, verified coverage in exact canonical bytes, or a nonempty candidate naming compatible target responsibilities. A `canonical_change_candidate` verdict without a target cannot become a null `pending_review` success. Existing canonical files do not prove semantic coverage. Such cases require a durable assessment/authority dependency with a bounded reason.

## Scoped writes and integration

Canonical drafts and normalization candidates remain private until reviewed. Canonical source edits use isolated managed workspaces, scoped path leases, sealing, required verification, and an exact integration plan. A result branch or accepted artifact alone is not integration.

The integrator binds current target revision, complete changed-path union, original and desired bytes, role/delegation, approvals, document-layout permit, and verification. Normalize complete document families, including split destinations and managed package metadata. Apply through the existing durable knowledge journal under path-conflict and target-generation fences. Never replace a shared checkout, stash user work, force a ref, or bypass dirty-target evidence to land a candidate.

Immediately before mutation, recheck target, source, protected user-region, resources, approvals, and leases. Overlap with a live writer waits; a changed target invalidates the plan. Seal and integrate canonical edits through the existing integration adapter. Apply normalization through the existing exact document transaction. Both require proof that desired bytes reached the canonical repository. Disjoint user changes require a fresh exact plan, not inherited snapshot approval.

Recovery inspects the journal, target bytes, source/result hashes, and event receipts. An interrupted apply resolves to proved applied, proved rolled back, or `recovery_required`. It cannot rerun a model, overwrite uncertain bytes, or mark the stage complete from file presence alone.

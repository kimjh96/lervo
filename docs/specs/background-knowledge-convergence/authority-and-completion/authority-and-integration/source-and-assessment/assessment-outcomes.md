# Assessment outcomes

The complete captured inventory fences source drift. Semantic worksets select only exact observed obligations: current Git changes, unresolved change events, pending normalization documents, and pending or stale canonicalization candidate bindings. Committed files without these obligations remain captured but consume no provider review. [ADR-0445](../../../../../decisions/knowledge/repository/canonicalization/0445-scope-baseline-assessment-to-observed-obligations.md) binds this scope without relaxing independent review or final lifecycle currency.

Semantic assessment returns one of:

- A source-bound no-durable-change rationale.
- Verified coverage in exact canonical bytes.
- A nonempty candidate naming compatible target responsibilities.

## Draft bindings and rejected assessments

Before independent review, every proposed draft binds its `beforeHash` to the complete captured repository source snapshot. Existing targets require their exact captured hashes; only targets absent from that snapshot may use `null`.

A rejected assessment may make one bounded fresh attempt using hashes for at most eight existing draft targets within the permitted canonical roots and at most 64 KiB of exact target text. If needed text is unavailable, it must choose `needs_review`. Repeated invalid bindings remain attention, never an approved replacement.

If an independent reviewer rejects a semantically valid assessment with no document normalization pending, the worker carries the review rationale into one new assessment of the same cursor. The rationale is untrusted input; new source, context, and draft hashes still require independent review. A second rejection stops with `attention_required` and cannot integrate the draft or advance coverage.

A `canonical_change_candidate` verdict without a target cannot become a null `pending_review` success. Existing canonical files do not prove semantic coverage. These cases require a durable assessment/authority dependency with a bounded reason.

## Reusing a prior batch

After a new baseline begins, an earlier draft-free canonical batch may be reused only if its integration stage settled `current` with independent approval. All these bindings must match exactly:

- Selected source bytes.
- Selected canonical context bytes and roles.
- Project.
- Reviewed delegation.
- Policy.

The reused assessment and approval carry the original integration event ID in the new stage receipts. Any changed binding requires fresh generation and review.

Reuse advances the new baseline's complete cursor without replaying provider calls for unchanged worksets. A previous rejection or unintegrated approval never supplies coverage.

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

## Settled dispositions

[ADR-0446](../../../../../decisions/knowledge/repository/canonicalization/0446-retain-integrated-dispositions-across-baseline-supersession.md) defines how a reviewed, integrated disposition outlives the snapshot that produced it. A decision settles only after independent approval and `current` canonical integration. That approval must match the assessment hash, source hashes, and draft hashes. Its reviewer must differ from its generator. The settled decision binds an exact source path, content hash, project, and policy.

Later baselines remove settled source bytes from semantic assessment. They record each removed path, hash, and integration event ID in private `settledAssessments`. `covered` stays settled only while every quoted passage remains in current bytes of its referenced canonical document. Delegation renewal does not invalidate a settled disposition.

`needs_review`, rejected, and unintegrated decisions never settle. Changed source bytes, a removed quote, a changed policy, or missing private evidence return the source to fresh generation and review.

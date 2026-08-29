# Provider-shadow v9 blind ground-truth audit packet

Status: `retained_unreviewed`
Date: 2026-08-29

## Result

ADR-0263 generated one immutable, owner-only audit packet for the two ambiguous v9 cases. It contains complete provider-free candidate envelopes: 16 candidates for `status_node_fleet` and 13 for `boundary_user_owned_block`, totaling 233,735 exact candidate-body bytes. The packet digest is `sha256:ca48c4d300885e2817c38801b39fb05739b3cfc0d7271b8f2d8a2ef83f3921b5`.

Generation reconstructed both provider arms and required identical requests, candidate identities, order, hashes, and byte counts before discarding provider-specific fields. Ordered by content hash, each candidate contains only an opaque audit candidate ID, repository-relative path, content hash, byte count, and exact v9 snapshot body. The packet omits provider, model, selected documents, current expected documents, accuracy, duration, usage, and execution coordinates.

The local packet is `.lervo/state/search/ground-truth-audits/linked-evidence-provider-shadow-v9-ground-truth-v1/audit-packet.json`; its packet-bound blank review form is `human-review-template.json` in the same directory. Both immutable source files use owner-only `0600`. Reviewers must fill a copy of the template. An exact packet rerun returned `unchanged`.

## Required human review

An eligible reviewer must not have seen provider outcomes or current expected paths during review and must use no model assistance. For each case, the reviewer must:

- Classify every candidate as `required_direct`, `acceptable_alternative`, `supporting_only`, or `not_relevant`.
- Bind every required claim to at least one `required_direct` or `acceptable_alternative` candidate.
- Choose `ground_truth_confirmed`, `ground_truth_revision_proposed`, or `insufficient_evidence`.
- Provide candidate and case rationale, an independence attestation, review time, and the exact packet digest.

The validator rejects partial coverage, unknown candidates or labels, missing claim evidence, outcome or expected-path exposure, model assistance, and stale packet digests.

## Authority and disposition

Packet generation made no provider call and changed no reviewed ground truth. It authorizes no measurement, managed-context effect, direct-terminal change, canary, or production activation. V9 remains immutable and rejected. Even a valid human revision proposal requires a separate content-bound apply decision.

ADR-0264 removed completion of this audit as an activation prerequisite because no eligible independent reviewer was available. It excluded both cases from the v10 numerator and denominator without reclassification. No review was fabricated, the packet remains incomplete, and its ground truth remains unchanged.

## Verification

- Focused contract tests passed for deterministic blinding, provider-pair mismatch, complete human review, partial review, model assistance, and stale packet rejection.
- The live packet dry run and exact write validated the v9 prepared manifest, phase A corpus, source repository commit, every source hash, both complete envelopes, and all size bounds.
- The second write converged without changing bytes.

## References

- [ADR-0263](../../decisions/search/activation/0263-require-blind-human-ground-truth-audit-after-v9.md)
- [V9 paired evidence](linked-evidence-provider-shadow-pilot-v9.md)
- [Exact audit contract](../../../benchmarks/search/linked-evidence-provider-shadow-v9-ground-truth-audit.json)
- [ADR-0264](../../decisions/search/activation/0264-measure-only-unambiguous-provider-shadow-cases-v10.md)

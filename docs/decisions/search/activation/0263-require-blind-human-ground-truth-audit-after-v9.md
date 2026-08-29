# ADR-0263: Require a blind human ground-truth audit after v9

Status: `accepted`
Date: 2026-08-29
Activation prerequisite: `superseded_by_ADR-0264`; packet and review contract retained

## Context

[Provider-shadow v9](../../../evidence/search/linked-evidence-provider-shadow-pilot-v9.md) produced six exact paired observations per provider but failed the unchanged recall gate. Two cases exposed plausible alternative sources. Provider outcomes cannot revise human-reviewed expected paths, and reviewing only provider-selected alternatives would reveal outcomes and bias the reviewer.

## Decision

Before another adaptive provider experiment, generate one provider-blind audit packet for `status_node_fleet` and `boundary_user_owned_block` from the exact prepared manifests and source snapshot. For every candidate, include the exact request, required claims, repository-relative path, content hash, byte count, and full source bytes.

Sort candidates by content hash. Omit provider identity, model, schedule and session coordinates, selected documents, current expected documents, accuracy, duration, and usage. The owner-only local packet:

- is limited to two cases, 16 candidates per case, and 260,000 candidate-body bytes; and
- never synchronizes to Hub.

An independent human who saw neither provider outcomes nor current expected paths during review and used no model assistance must:

- classify every candidate as `required_direct`, `acceptable_alternative`, `supporting_only`, or `not_relevant`;
- bind every required claim to direct evidence;
- provide one case disposition; and
- bind the exact packet digest.

Missing, partial, model-assisted, outcome-exposed, stale, or expected-path-exposed review fails closed.

Packet generation authorizes no provider calls or ground-truth mutation. A valid review may propose a revision, but canonical ground truth may change only through a separate content-bound apply decision. V9 remains immutable and rejected. The 24-by-24 measurement, managed context, direct terminals, canary traffic, and production activation remain unauthorized.

[ADR-0264](0264-measure-only-unambiguous-provider-shadow-cases-v10.md) later removed completion of this audit as an activation prerequisite and excluded both ambiguous cases from the next measurement without reclassification. The packet remains incomplete evidence and may support a later, separate ground-truth decision.

## Verification

- Verify both provider arms had identical request and candidate-envelope bytes before removing provider fields.
- Verify every packet body against the v9 source corpus content hash.
- Prove deterministic ordering and the absence of every prohibited field.
- Reject incomplete candidate or claim coverage, model assistance, outcome or expected-path exposure, wrong packet digests, and unknown labels.
- Run focused tests, quality, documentation, knowledge, full-repository, and task-base release-completion checks.

## References

- [ADR-0262](0262-test-minimal-sufficient-paired-provider-selection-v9.md)
- [Exact audit contract](../../../../benchmarks/search/linked-evidence-provider-shadow-v9-ground-truth-audit.json)
- [V9 paired evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v9.md)
- [ADR-0264](0264-measure-only-unambiguous-provider-shadow-cases-v10.md)

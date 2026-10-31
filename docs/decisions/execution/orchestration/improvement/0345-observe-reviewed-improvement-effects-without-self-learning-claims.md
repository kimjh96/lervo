# ADR-0345: Observe reviewed improvement effects without self-learning claims

- Status: `historical`
- Decision date: 2026-09-02

Amended by: [ADR-0533](../../../knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The development-pattern pipeline is historical and its commands are removed.

## Context

Lervo could detect, review, and promote recurring repository development patterns but lacked a bounded post-promotion comparison. Calling stored output "learning," measuring only after a change, treating a proxy metric as correctness, or letting an unfavorable observation roll back a canonical source would conflate review, causation, and authority while overstating the evidence.

## Decision

Register an exact baseline protocol while the pattern is `reviewed` and before promotion. Bind the protocol to the candidate, review, intended target, request, versioned observation adapter, metric set, observation window, and adapter-verified rate evidence. Compare a post-promotion treatment window only while the same protocol, adapter, metric set, promotion, current pattern state, and exact target remain valid.

Keep validation and comparison policy pure in `@lervo/work-controller`. Place observation behavior behind the storage-free `ImprovementObservationPortV1`; the stock CLI receives no external observation authority. Store complete bounded protocols and comparisons in local CAS, retain only privacy-bounded coordinates in two canonical events, and make the current effect view rebuildable.

Report only observational outcomes and always state that attribution is unestablished. An unfavorable result requires review but never performs, approves, or retries rollback. Never describe model output, memory, materialization, retrieval, or a favorable comparison as model-weight learning, truth, or correctness.

## Consequences

Lervo can evaluate reviewed repository improvements through replaceable measurement adapters while remaining local without a Hub. New metrics and causal designs require versioned policy and adapter contracts rather than silently changing historical meaning. Products may display observations, but canonical-source authority remains with the existing review and promotion lifecycle.

## References

- [Verified improvement effects](../../../../specifications/execution/verified-improvement-effects.md)
- [Development-pattern lifecycle](../../../../specs/repository-development-pattern-lifecycle.md)
- [Product positioning research](../../../../research/lervo-product-positioning-and-verified-improvement.md)

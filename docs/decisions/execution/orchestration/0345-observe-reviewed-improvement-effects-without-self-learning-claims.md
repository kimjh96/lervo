# ADR-0345: Observe reviewed improvement effects without self-learning claims

- Status: `accepted`
- Decision date: 2026-09-02

## Context

Lervo could detect, review, and promote recurring repository development patterns, but it had no
bounded comparison after promotion. Calling stored output "learning," measuring only after the
change, treating a proxy metric as correctness, or allowing a bad observation to roll back a
canonical source would overstate evidence and collapse review, causation, and authority.

## Decision

Require an exact baseline protocol to be registered while the pattern is `reviewed` and before its
promotion event. Bind it to the candidate, review, intended target, request, versioned observation
adapter, metric set, observation window, and adapter-verified rate evidence. After promotion,
compare a treatment window only when the same protocol, adapter, metric set, promotion, current
pattern state, and exact target remain valid.

Keep validation and comparison policy pure in `@lervo/work-controller`. Put observation behavior
behind the storage-free `ImprovementObservationPortV1`; the stock CLI receives no external
observation authority. Store full bounded protocols and comparisons in local CAS, retain only
privacy-bounded coordinates in two canonical events, and keep the current effect view rebuildable.

Use only observational outcomes. Always report attribution as unestablished. An unfavorable result
requires review but never performs, approves, or retries rollback. Do not describe model output,
memory, materialization, retrieval, or a favorable comparison as model-weight learning, truth, or
correctness.

## Consequences

Lervo can evaluate reviewed repository improvements across replaceable measurement adapters while
remaining local without a Hub. New metrics or causal designs require versioned policy and adapter
contracts instead of silently changing historical meaning. Products may display the observations,
but canonical-source authority remains in the existing review and promotion lifecycle.

## References

- [Verified improvement effects](../../../specifications/execution/verified-improvement-effects.md)
- [Development-pattern lifecycle](../../../specs/repository-development-pattern-lifecycle.md)
- [Product positioning research](../../../research/lervo-product-positioning-and-verified-improvement.md)

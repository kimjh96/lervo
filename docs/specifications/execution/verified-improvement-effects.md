# Verified improvement effects

Status: `active`
As of: 2026-09-02

This specification defines privacy-bounded post-promotion observation for reviewed development
patterns. It measures observable repository outcomes. It does not update model weights, prove
semantic correctness, establish causation, or authorize automatic rollback.

## Lifecycle

1. While a pattern is exactly `reviewed`, a caller supplies a version-1 protocol request with the
   accepted candidate and review hashes, intended target hash, request digest, versioned observation
   adapter descriptor, time-bounded baseline, and verified rate observations.
2. `knowledge pattern effect register` creates a deterministic plan. Exact apply re-inspects the
   injected adapter, verifies the same observations, stores the full protocol in CAS, and appends
   `development.pattern.evaluation.registered` before promotion.
3. Existing exact promotion remains the only canonical-source mutation.
4. After promotion, `knowledge pattern effect observe` binds the registered protocol, exact
   promotion event, unchanged target, same adapter and metric set, and a treatment window beginning
   after promotion. Exact apply re-verifies the treatment, stores the comparison in CAS, and appends
   `development.pattern.effect.observed`.

The stock CLI can plan from bounded JSON but has no observation-verification authority. A host must
inject `ImprovementObservationPortV1`; provider-native queries, credentials, samples, and raw
evidence remain adapter-private.

## Metric policy and claims

Version 1 supports `source_recall`, `unnecessary_context`, `verification_success`,
`repeated_failure`, `rework`, and `user_correction`. Each observation is a bounded numerator and
denominator plus evidence-set and adapter-receipt hashes. The pure controller compares integer
basis points with fixed version-1 direction and materiality thresholds. A denominator below ten is
insufficient evidence.

Per-metric results are `favorable_observation`, `unfavorable_observation`,
`no_material_difference`, or `insufficient_evidence`. The aggregate is favorable,
mixed-or-unfavorable, no-material-difference, or inconclusive. Every result retains
`attribution=unestablished`. An unfavorable aggregate sets `rollbackDisposition=review_required`;
all other results set `not_authorized`. Neither value performs or approves rollback.

## Canonical and derived state

Protocol and comparison bodies are immutable CAS artifacts. The two hash-chained events are
canonical evidence. `.lervo/state/knowledge/improvement-effects/current.json` is a bounded,
rebuildable projection and can be deleted without losing the protocol or comparison. New effect
events do not alter the existing development-pattern lifecycle projection.

Exact replays return the existing event. A conflicting deterministic identity, stale plan, adapter
drift, pattern or target drift, metric drift, invalid timing, malformed receipt, CAS failure, or
event failure records no success. Missing observations mean unobserved, not zero or no effect.

## Privacy

Events retain only opaque pattern, protocol, comparison, event, plan, artifact, adapter, metric,
time, count, disposition, and hash coordinates. They exclude request prose, candidate and target
bodies, repository paths, raw samples, native provider identifiers, prompts, outputs, user
identity, credentials, costs, and unrestricted errors. Full bounded requests and comparisons stay
in local CAS; adapter-native evidence stays behind the port.

## References

- [Repository development-pattern lifecycle](../../specs/repository-development-pattern-lifecycle.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0345](../../decisions/execution/orchestration/0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)

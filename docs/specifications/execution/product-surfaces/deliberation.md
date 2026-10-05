# Deliberation product integration

Formal deliberation is a bounded decision workflow, not a synonym for multi-agent conversation.

## Applicability and responsibility

| Situation | Default path |
| --- | --- |
| Ordinary question, progress update, or role-relevant discussion | Multi-party conversation |
| Routine code or document verification | Owning work and verification contracts |
| Independent implementation acceptance | Outcome supervision or assigned review |
| Explicit independent challenge, competing designs, consensus, or high-assurance decision | Formal deliberation |
| Ambiguous language or agent suggestion to debate | Recommend or clarify; do not start |
| Policy-detected decision point: ADR authoring, core change, design fork, agent disagreement, repeated verification failure, or consequential proxy decision | Tiered deliberation under [ADR-0460](../../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md) (proposed): Tier 0 cross-check by default, escalating by value for cost |

The application composes existing deliberation control, queue, runtime, artifact, verification, and event contracts. It owns origin correlation and product queries, but cannot decide convergence, weaken policy, or promote a decision.

## Contracts

- [Origin and participant binding](deliberation/origin-and-participants.md): durable origin, accepted routes, authorship, and policy responsibilities.
- [Surface behavior](deliberation/surface-behavior.md): presentation, publication, delivery, recovery, and process integration.
- [Bounds and resources](deliberation/bounds-and-resources.md): budgets, evidence, provider restrictions, and accounting.
- [Results and evolution](deliberation/results-and-evolution.md): outcomes, search, canonicalization, compatibility, and host projection.

## References

- [ADR-0418](../../../decisions/execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md)
- [Application projections](application-projections.md)
- [Surface observability](observability.md)
- [Discord and host acceptance](discord-and-host-acceptance.md)

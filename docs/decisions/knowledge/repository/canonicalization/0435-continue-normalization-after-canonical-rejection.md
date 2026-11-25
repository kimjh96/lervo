# ADR-0435: Continue normalization after canonical rejection

Status: `accepted`
Decision date: 2026-09-28
Amended by: [ADR-0479](../../semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) (rejected canonical worksets are isolated and parked instead of handed off)
Amended by: [ADR-0449](0449-synchronize-integration-target-with-working-branch.md)

## Context

The authorized installed continuation of ADR-0434 encountered a genuine canonical rejection: the independent reviewer found unresolved source dispositions, conflicting documentation, and insufficient exact coverage. Rejection correctly blocked integration but also stopped independently reviewable normalization debt before generation and review.

## Decision

When a canonical proposal is rejected and the same baseline has normalization debt, retain the exact rejection and source bindings in private CAS and durably hand off to normalization generation. Clear the rejected batch and its approval from the integration path. The handoff proves review ran; it establishes neither accepted canonical disposition nor semantic coverage.

Normalization retains its independent generator and reviewer, exact target hashes, permitted roots, verification, and apply fences. Reconcile projections and bridges after accepted normalization. While the retained canonical rejection remains unresolved, final lifecycle verification returns `attention_required/knowledge_semantic_review_rejected`; it cannot emit baseline `current` or count rejected sources as covered.

A historical canonical rejection may resume this independent work only when normalization debt exists and the queued successor binds its exact predecessor, source snapshot, and assessment hash. Reuse its validated review result without another model call. A final retained rejection is content-bound and does not repeatedly wake or regenerate unchanged proposals. Genuine source or authority changes retain existing supersession and reevaluation rules.

## Evidence and privacy

No event types change. Existing stage and handoff envelopes retain their required fields. The `canonical_review` receipt's `rejection_retained` proof binds a rejection artifact hash. The private artifact contains the exact assessment, reviewer result or predecessor proof, source bindings, and `retainedForNormalization: true`. Public events retain only existing hashes and normalized failure codes; rejection text and document bytes remain private artifacts.

Final rejection means canonical debt still needs resolution even when independently accepted normalization and projections are current. It is neither an apply failure nor permission to overwrite a canonical target. Unsupported assets, uncertain effects, and failed verification continue to stop their own governed stages.

## References

- [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md)
- [Runtime contract](../../../../specs/background-knowledge-convergence/runtime.md)
- [Implementation evidence](../../../../evidence/quality/background-knowledge-convergence-implementation.md)

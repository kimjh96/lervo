# ADR-0435: Continue normalization after canonical rejection

Status: `accepted`
Decision date: 2026-09-28

## Context

The authorized installed continuation of ADR-0434 encountered a genuine canonical rejection. The independent reviewer found unresolved source dispositions, conflicting documentation and insufficient exact coverage. Rejecting that proposal correctly prevented integration, but also stopped independently reviewable normalization debt before it could receive its own generation and review.

## Decision

When a canonical proposal is rejected and the same baseline has normalization debt, retain the exact rejection and source bindings in private CAS and durably hand off to normalization generation. Clear the rejected batch and its approval from the integration path. This handoff proves that review ran; it establishes no accepted canonical disposition or semantic coverage.

Normalization retains its independent generator, reviewer, exact target hashes, permitted roots, verification and apply fences. Reconcile projections and bridges after accepted normalization. Final lifecycle verification still returns `attention_required/knowledge_semantic_review_rejected` while the retained canonical rejection remains unresolved. It cannot emit baseline `current` or count rejected sources as covered.

A historical canonical rejection can resume this independent work only when normalization debt exists and the queued successor binds its exact predecessor, source snapshot and assessment hash. Reuse its validated review result without another model call. A final retained rejection is content-bound and does not repeatedly wake or regenerate unchanged proposals. Genuine source or authority changes retain the existing supersession and reevaluation rules.

## Evidence and privacy

No event type changes. Existing stage and handoff envelopes retain their required fields. The `canonical_review` receipt's `rejection_retained` proof binds a rejection artifact hash. Its private artifact contains the exact assessment, reviewer result or predecessor proof, source bindings and `retainedForNormalization: true`. Public events retain only existing hashes and normalized failure codes. Rejection text and document bytes remain private artifacts.

The final rejection means canonical debt still requires resolution even if independently accepted normalization and projections are current. It is not an apply failure or permission to overwrite a canonical target. Unsupported assets, uncertain effects and failed verification continue to stop their own governed stages.

## References

- [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md)
- [Runtime contract](../../../../specs/background-knowledge-convergence/runtime.md)
- [Implementation evidence](../../../../evidence/quality/background-knowledge-convergence-implementation.md)

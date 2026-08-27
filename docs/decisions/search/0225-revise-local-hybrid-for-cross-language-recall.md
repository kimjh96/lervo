# ADR-0225: Revise the local hybrid candidate for cross-language recall

Status: `superseded`
Decision date: 2026-08-27

Superseded by [ADR-0226](0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md).

## Context

`local-hybrid-v1` combines lexical ranking with deterministic hashed word, word-pair, and character-trigram features. This improves morphology-adjacent retrieval within a shared script but does not encode translation equivalence.

A same-corpus replay confirmed the prior result. Both engines scored 19 of 20 on the Korean-framed suite. On the English control, `lexical-v1` scored 17 of 20 and the candidate scored 18 of 20, while the selected-skill case regressed from rank 5 to rank 10. Neither suite passed all four task-type gates.

Three Korean-only historical-rationale probes expected the English-only ADR for structured workstream continuation. Operational lexical search returned no hits for all three. A bounded candidate diagnostic ranked the expected ADR at 15 for one probe and outside the top 50 for the other two. Because the target contains no Hangul, this is not evidence of a missing fusion weight. Two targets were absent from the candidate branch depth, and the remaining result was not top-10 eligible.

## Decision

Keep `lexical-v1` operational. Keep `local-hybrid-v1` registered and inactive so prior reports remain reproducible, but classify its natural-language search disposition as **revise**. Do not start its activation chain.

Do not tune fusion weights or add query-specific Korean-to-English aliases from authored fixtures. Weight changes cannot recover documents absent from both top-50 branches. Hard-coded aliases would encode expected answers, overfit repository examples, and blur deterministic search with conversational interpretation.

Any successor candidate must declare and bind its cross-language mechanism instead of implying one from character similarity. It must:

- preserve local execution without a Hub;
- keep provider behavior behind adapters;
- exclude query and source bodies from reports; and
- version every model, projection, or reviewed alias input that affects index identity.

Before activation can be considered, evaluation must include exact case-level review, every task-type gate, zero reviewed baseline regressions, replay, and separate cost observation.

Conversational grounding may resolve a prior-turn or workstream reference directly to a canonical source. This is context resolution, not search-engine success, and must remain outside search scores and result-set identity.

Human review is required to promote fixtures into production-like evidence or authorize future activation. It does not block read-only diagnosis or a conservative decision to leave a failing candidate inactive. A generic continuation request is not case-level approval.

This decision changes no event, evidence level, operational selection state, or runtime failure code.

## Verification

The fresh paired reports bind the same 263-document corpus digest. Public discovery probes bind their exact text and expected path; operational reports remain owner-only. Repository validators continue to reject provenance promotion, false task-type coverage, and activation authority.

## Consequences

The current hybrid candidate remains available for deterministic comparison but is not treated as a multilingual solution. Natural-language quality work may proceed without user approval of a bulk fixture set, while production-quality and rollout claims remain fail-closed.

See [ADR-0217](0217-local-hybrid-search-and-reviewed-relation-context.md), [ADR-0224](0224-natural-language-grounding-quality-evaluation.md), the [Korean-framed retrieval observation](../../evidence/search/korean-repository-retrieval-v1.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

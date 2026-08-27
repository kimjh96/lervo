# Natural-language grounding quality

Status: `active`
Started: 2026-08-27

## Objective

Validate practical Korean and mixed-language repository requests while keeping search ranking, conversational grounding, approval authority, and evidence of use distinct. Production routing uses typed same-provider semantic grounding. Lexical scoring only retrieves candidates and may be followed by bounded autonomous inspection; a future v2 may improve ranking without regaining routing authority.

## Evaluation layers

| Layer | Input | Required output | Activation authority |
| --- | --- | --- | --- |
| Engine retrieval | One deterministic query and reviewed expected paths | Top-10 success, recall, reciprocal rank, and per-task comparison | None; observation only |
| Conversational grounding | Prompt, bounded prior turns, workstream availability, authority, and repository condition | Separate intent, reference, source-class, disposition, required-behavior, and prohibited-behavior verdicts | None; observation only |
| Managed execution evidence | Canonical run and context events | Selected, loaded, injected, referenced, and missing stages without inferred use | Existing execution policy only |

## Case matrix

- 20 Korean-framed retrieval cases and 20 one-to-one English controls.
- Four retrieval task types with exactly five cases each.
- 32 grounding cases across eight categories with exactly four cases each.
- Positive, ambiguous, abstention, stale-binding, no-source, and unreviewed-relation cases.
- Identical prompts under contexts requiring different dispositions.
- Public fixture text with digest-only runtime events and report redaction.

Initial suites remain `verification_authored` and `pending_human_review`; they cannot authorize hybrid activation or establish production representativeness.

## Current observations

The initial paired run used the same 263-document corpus digest for both suites. Korean-framed queries achieved 19/20 Success@10 with each engine. English controls achieved 17/20 with `lexical-v1` and 18/20 with `local-hybrid-v1`. Both aggregate quality decisions failed, neither suite passed every task-type gate, and English controls had one candidate-ranking regression. Operational search remains `lexical-v1`. See the [Korean-framed repository retrieval observation](../evidence/search/korean-repository-retrieval-v1.md).

The 32-case suite validates recorded typed provider observations for intent, reference resolution, source classes, disposition, required behaviors, and prohibited behaviors. The removed phrase-list resolver duplicated the routing defect under evaluation. The suite distinguishes fresh-clone recovery from missing-source failure and covers Korean, mixed-language, shorthand, indirect reference, ambiguity, approval, hash drift, and unreviewed graph recommendations. It is evaluation evidence, not proof that every future provider response is correct.

Agent pre-review covers all 20 paired retrieval cases and 32 grounding cases: 43 are ready for human review, while nine have explicit attention reasons. A same-corpus replay found four lexical failure candidates across three task types and one English hybrid rank regression. Three public Korean historical-rationale probes produced operational lexical no-hits, but none is human-reviewed real-use evidence; real-failure coverage remains incomplete. Provenance and review status did not change. See the [natural-language case pre-review](../evidence/search/natural-language-case-pre-review-v1.md).

Fresh paired reports reproduced the earlier quality result. Direct candidate replay of the three Korean-only historical-rationale probes placed the expected English ADR at rank 15 once and outside the top 50 twice. ADR-0225 therefore kept `local-hybrid-v1` inactive and marked it for revision rather than tuning fusion weights or adding fixture-specific bilingual aliases. Human review still gates production claims and future activation, but not negative diagnosis or normal engineering work without bulk fixture approval.

A same-model delegated retrieval pilot compared direct read-only repository exploration with top-three lexical assistance across eight cases. Direct exploration found every expected path in 7/8 cases versus 5/8 for lexical assistance, using 38 repository commands and 1,203,427 observed total tokens versus 10 commands and 592,630 tokens. It recovered all three Korean-only no-hit probes. Lexical assistance was faster when recommendations existed but missed secondary sources in two multi-source cases despite high provider confidence. ADR-0226 supersedes the revision disposition: retire `local-hybrid-v1`, keep `lexical-v1` operational, and evaluate a bounded no-hit and mandatory-verification fallback instead of unconditional model delegation. See the [delegated retrieval pilot](../evidence/search/delegated-retrieval-pilot-v1.md).

The pre-registered repeated comparison rejected bounded fallback v1. Across 16 observations per arm, model direct passed 12, lexical assisted passed 13, and bounded fallback passed 11. Bounded fallback used 93.33% of direct tokens, took 105.11% of direct duration, and passed both repetitions for only five cases against a minimum of six. Mandatory verification lost a lexically recommended Node-fleet source twice and completed fuzzy-merge evidence only once. Operational search remains `lexical-v1`; bounded fallback v1 is not an activation candidate. See the [bounded fallback observation](../evidence/search/bounded-retrieval-fallback-v1.md).

## Delivery sequence

1. Validate checked-in pair invariants, category coverage, current expected paths, authority, privacy, and fail-closed behavior.
2. Run Korean and English retrieval suites separately against the same repository corpus state.
3. Record per-pair and per-task observations, including Korean corpus limitations and every baseline regression.
4. Completed for engineering diagnosis: all 20 retrieval pairs and 32 grounding cases have a complete agent pre-review partition; four lexical failure candidates, one rank regression, and three historical-rationale discovery probes are recorded. Case-level human review is deferred but remains required for provenance promotion, production-quality claims, or activation.
5. Completed: add a provider-neutral grounding runner outside `@lervo/search` for deterministic intent, reference, source-class, authority, disposition, and behavior checks. Human review remains required for production claims and the search-quality decision.
6. Completed: terminal selection policy, exact-hash loading, bounded hook assembly, and telemetry are separate modules. Candidate, selected, loaded, and hook-prepared observations remain distinct; provider injection is unobserved and provider use unknown.
7. Pending conditionally: add answer-grounding judgment only when a managed content-addressed answer artifact and provider delivery receipt exist, with named unavailable, invalid, stale, missing, and truncated failures.
8. Completed: the inactive `local-hybrid-v1` revision path was rejected after the delegated retrieval pilot. Its runtime package, registry entry, dedicated benchmark command, and bundled dependency were removed; historical reports and decisions remain canonical evidence.
9. Completed and rejected: v1 used lexical recommendations first, direct exploration on no-hits, and mandatory verification for impact and approval or ownership boundaries. Two repetitions, explicit triggers, failure meanings, redacted evidence, and pre-registered quality and resource thresholds showed a lower pass count, insufficient repeatability, no token target, and slower aggregate execution. Do not activate v1.
10. Next search-quality cycle: `lexical-assisted-v2` is a new pre-registered experiment, not an active runtime policy. Preserve every relevant lexical recommendation in the answer evidence set and permit provider-directed read-only exploration only when the provider names an explicit evidence gap. A no-hit is such a gap; question category alone is not a trigger. The repeated suite must include ordinary implementation requests, historical-rationale questions such as “why did we do this?”, terse “do OO” requests, impact questions, and approval or ownership boundaries. Run at least three contemporaneous repetitions per arm against one bound snapshot and model. Compare model-direct and lexical-assisted v2 using exact expected paths, grounded-answer verdicts, repository commands, observed tokens, p50/p95 duration, and no-hit latency variance. Pre-register quality, repeatability, token, and latency thresholds. Do not activate managed provider calls, reinterpret confidence as completeness, or relax v1 thresholds without a separately reviewed result.

## Completion criteria

- Every checked-in suite passes the repository validator and focused negative tests.
- Paired benchmark reports bind the same corpus digest and disclose the English-dominant corpus limit.
- Human-reviewed cases include real lexical failures for every declared task type; synthetic success cannot substitute.
- Grounding results report intent, reference, source class, and disposition separately.
- Ambiguous references, missing workstreams, stale hashes, absent authority, no matching sources, and unreviewed graph relations fail closed without invented paths or rationale.
- Search, graph recommendation, grounding quality, and managed execution evidence remain separate contracts.
- No result upgrades selected, loaded, injected, referenced, or used beyond observed telemetry.
- Relevant tests, quality checks, documentation lifecycle, knowledge refresh, and release-completion review pass.

See [ADR-0224](../decisions/search/0224-natural-language-grounding-quality-evaluation.md), [ADR-0225](../decisions/search/0225-revise-local-hybrid-for-cross-language-recall.md), [ADR-0226](../decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md), the [delegated retrieval pilot](../evidence/search/delegated-retrieval-pilot-v1.md), and the [bounded fallback observation](../evidence/search/bounded-retrieval-fallback-v1.md).

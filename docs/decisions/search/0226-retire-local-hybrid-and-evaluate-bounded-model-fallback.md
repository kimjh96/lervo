# ADR-0226: Retire local hybrid and evaluate a bounded model fallback

Status: `accepted`
Decision date: 2026-08-27

## Context

ADR-0225 kept `local-hybrid-v1` inactive and requested an explicit cross-language successor. For three Korean-only historical-rationale probes, lexical search returned no hits; the hybrid candidate ranked the expected English ADR at 15 once and outside its top 50 twice.

A provider-adapter benchmark compared two read-only arms using the same `gpt-5.6-sol` model and sanitized repository snapshot. `model_direct` received the protocol and repository access. `lexical_assisted` also received the top three `lexical-v1` documents. The 263-document corpus and, where necessary, model workspace excluded benchmark fixtures, search evidence, generated knowledge, and evaluated decisions to prevent answer leakage.

Across eight verification-authored cases, direct exploration found every expected path in seven cases, versus five with lexical assistance, and recovered all three Korean-only no-hit probes. In the five cases with lexical recommendations, the assisted model ran no repository commands but failed to verify missing secondary sources for the Node-fleet and fuzzy-merge cases. It was faster and used fewer observed tokens, but high confidence did not predict source completeness.

## Decision

Retire `local-hybrid-v1`. Do not create or activate another sparse-hash hybrid solely for the observed Korean-to-English gap. Remove the inactive candidate package, registry entry, dedicated benchmark command, and bundled dependency. Preserve checked-in historical reports and ADRs as evidence. Keep generic candidate-comparison and evaluation contracts for registered candidates.

Keep `lexical-v1` as the deterministic operational search engine; do not globally replace it with direct model exploration. The pilot's direct arm used 38 repository commands and 1,203,427 observed total tokens, versus 10 commands and 592,630 tokens for the assisted arm. These are provider-usage observations, not billed-cost claims.

Evaluate a provider-neutral bounded fallback policy that:

1. presents top-ranked lexical documents as recommendations, never proof of completeness;
2. invokes read-only repository exploration when lexical search returns no hits;
3. requires bounded verification for multi-source, impact, and approval-boundary questions even when lexical hits exist;
4. measures exact expected-source coverage and grounded answers, not provider confidence; and
5. exposes model choice, tools, usage, duration, snapshot, corpus, and fallback reason through provider adapters.

The repository owner accepted this lexical-first shape as the bounded fallback v1 target on 2026-08-27. This approval selects the policy shape; it neither makes the one-run pilot production evidence nor silently activates model calls. Before managed execution may depend on v1, a follow-up must add repeated trials, an explicit fallback-trigger contract, redacted durable reports, and failure meanings.

Treat v2 as an evidence-driven improvement after v1 produces repeatable measurements. V2 may revise trigger classification, verification breadth, or resource budgets, but must preserve provider neutrality, exact-source coverage, observable fallback reasons, and the distinction between recommendations and proof of completeness.

This decision changes no current event, evidence level, search-result identity, or operational engine selection.

## Bounded fallback v1 outcome

The repeated v1 comparison rejected the mandatory-verification policy. Across 16 observations per arm, bounded fallback passed 11, versus 12 for model direct and 13 for lexical assisted. It passed both repetitions for five of eight cases, used 93.33% of model-direct observed total tokens, and took 105.11% of model-direct wall duration. It failed the pre-registered repeated-case, pass-count, token-ratio, and duration-ratio criteria; recall non-inferiority and all trigger and provider contracts passed.

Do not activate bounded fallback v1. Mandatory independent inspection caused the model to omit a lexically recommended expected Node-fleet source in both repetitions and produced only one complete fuzzy-merge result in two repetitions. For no-hit cases, it matched direct quality but used more tokens and time. Keep the runner and suite as a negative baseline, not as dormant runtime policy.

The lexical-assisted arm passed 13/16 using 52.44% of model-direct tokens, but was 10.29% slower in aggregate and already permitted autonomous repository inspection when recommendations were missing or insufficient. This supports retaining lexical recommendations with optional model exploration for evaluation; it does not authorize silent model calls or establish production quality.

Any v2 experiment must pre-register a narrower evidence-gap trigger, preserve relevant recommended paths during verification, and measure no-hit latency variance. It must not relax v1 thresholds after the observed failure.

## Verification

The final pilot binds executed suite digest `sha256:e3a367f295e101affa218bf12069d0e48d75804d66242b7847cb0ba3f5298e28`, corpus digest `sha256:2a98791084cba8c1318fcf1a01d15836cd179bb075fcd92047af6b98633fa7eb`, repository base `bd8f5c7c994078558c6bfc2de2decbdf0463c960`, and raw operator-only report digest `sha256:8c3fce6a24ea3ce1c660e566a994668dacbee444fff15f82428a09ee1e6346ac`.

The checked-in suite digest is `sha256:6daa021a84f0d9ae95b3f8e6889ff53c7426b6c52216704d66dc6d22dde4a82b`. It adds ADR-0226 and later ADR-0227 to the exclusion list so decisions about evaluated behavior cannot influence future replays. Neither decision existed during execution, so these self-exclusions change the suite source digest but not the executed 263-document corpus, cases, queries, recommendations, or verdicts.

The first preflight execution used an empty registered-document corpus and is excluded from the decision. Before any model call, the accepted execution used the retrieval suites' explicit Markdown corpus boundary and confirmed 263 sources.

The bounded fallback comparison binds executed suite digest `sha256:da080fff002d9f9ee086f5125a03a4b19dce94b7b0dd0f5e9c5a7b646a3bdd62`, the same corpus digest, the same repository base, and raw operator-only report digest `sha256:bd88e34b75c627992a0f24abed3e6cc64ba7c56661525fa2bcf807fc60d07f3a`. It completed 48 provider turns: eight cases, three arms, and two repetitions. The checked-in suite later added ADR-0227 to its exclusions and has digest `sha256:a5e180bc87d2fdefa8ce2d499e685da5568c8d3c37f0540dc9c2390123c5ef45`; the executed observation is unchanged. See the [redacted bounded fallback observation](../../evidence/search/bounded-retrieval-fallback-v1.md).

## Consequences

Lervo stops investing in a deterministic candidate that cannot express translation equivalence. The retired package and dedicated CLI benchmark surface are absent from current runtime and distribution inputs; historical reports remain reviewable. Direct model exploration is a measured evaluation capability, not a silent search replacement. Mandatory bounded fallback v1 is rejected. Lexical recommendations may reduce provider usage, but neither their presence nor model confidence proves completeness, and the repeated comparison did not establish an aggregate latency reduction.

See the [delegated retrieval pilot observation](../../evidence/search/delegated-retrieval-pilot-v1.md), [ADR-0224](0224-natural-language-grounding-quality-evaluation.md), [ADR-0225](0225-revise-local-hybrid-for-cross-language-recall.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

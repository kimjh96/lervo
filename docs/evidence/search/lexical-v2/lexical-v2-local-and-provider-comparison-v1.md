# Lexical-v2 local and provider comparison v1

Status: `rejected for activation`  
Observed: 2026-08-30

## Question

Can a deterministic lexical-v2 candidate improve repository retrieval accuracy and latency while reducing end-to-end Codex and Claude token use and duration without weakening answer quality?

No, not under this candidate and protocol. Local ranking improved, but the existing activation-quality threshold, Codex end-to-end gates, and Claude result-validity boundary did not all pass. Operational retrieval remains `lexical-v1`.

## Candidate

`@lervo/search-adapter-lexical-v2` registers engine `lexical:2` with adapter build `sebuild_6ee80b53f62db1f1994553a2`. It combines:

- lexical-v1-compatible weighted field ranking;
- Unicode word BM25F;
- identifier splitting at camel case, separators, and digit boundaries;
- Latin identifier and spelling trigram fallback only when an exact query term is absent; and
- deterministic weighted reciprocal-rank fusion.

The fallback restriction was added before live provider calls. An initial provider-free dry run found that unrestricted Korean character similarity displaced the expected fuzzy-merge evidence from the top three. The final build preserves that regression case. The candidate has no reviewed-query keywords, translations, aliases, synonyms, or question-category routes.

## Local comparison

Both reports used 30 alternating build pairs, five query warmups, 30 recorded query repetitions, a final limit of 50, and the exact current corpus declared by each suite.

| Suite | Engine | Success@10 | Mean recall@10 | Mean reciprocal rank | Build p50 | Query p50 | Query p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| English, report `spreport_bedc2976d8b0c27297110597` | lexical-v1 | 19/20 | 84.17% | 48.14% | 31.98 ms | 2.98 ms | 3.96 ms |
| English | lexical-v2 | 19/20 | 88.33% | 70.97% | 73.48 ms | 2.35 ms | 3.64 ms |
| Korean, report `spreport_6b365cedb746a081efa876cb` | lexical-v1 | 18/20 | 82.50% | 64.58% | 31.32 ms | 2.69 ms | 3.47 ms |
| Korean | lexical-v2 | 18/20 | 82.50% | 70.67% | 72.25 ms | 1.84 ms | 2.99 ms |

Lexical-v2 improved aggregate recall or rank and reduced warm-query latency, but its build p50 was about 2.30 times baseline. More importantly, the pre-existing benchmark requires at least one candidate-only success and no baseline-only success in every task type. Neither suite passed: both reported `qualityObservation: threshold_not_met`, and case-level ranking regressions remained. This evidence supports continued evaluation, not activation.

The BM25F control queried faster but lost success and recall in both suites. It remains a control, not a substitute.

## Paired provider contract

The checked-in suite is [`lexical-v2-provider-comparison-v1.json`](../../../../benchmarks/search/lexical-v2-provider-comparison-v1.json), digest `sha256:4916d3b13ee00b3b789eea8dff7b845dfe191aae06ea01ef299113edf6061406`. It binds eight public Korean and mixed-language cases, two per task type, top-three whole-document evidence, three repetitions, alternating arm order, independent sessions, no retries, no repository tools, and at most 48 invocations per provider.

Each provider independently had to preserve per-case pass count, recall, and precision; use no more than 90% of baseline reported tokens and 95% of baseline duration; provide complete usage; and produce zero contract, tool, or command failures. Provider usage is descriptive adapter telemetry, not billed cost, and values cannot be compared across providers.

The corpus digest was `sha256:a09cbcc2fa6430d8637e4e1b4f66e44e0e07c4518a99065d17f9637a4f617c16`. Five of eight cases had identical top-three paths in both arms. Across 24 observations per arm, lexical-v2 injected 432,792 bytes versus lexical-v1's 429,051 bytes, an increase of 0.87%. The engine-only hypothesis therefore had no deterministic context-byte mechanism for reducing tokens by 10%.

## Codex observation

Codex `gpt-5.6-sol` completed all 48 sessions with complete usage and no provider errors, tool or command observations, or contract failures.

| Measure | lexical-v1 | lexical-v2 | Result |
| --- | ---: | ---: | --- |
| Passed answers | 18/24 | 18/24 | non-inferior |
| Cases passing every repetition | 6/8 | 6/8 | tied |
| Expected-path recall | 81.25% | 81.25% | tied |
| Returned-path precision | 62.50% | 61.81% | failed non-inferiority |
| Reported total tokens | 590,739 | 593,975 | ratio 100.55%; failed |
| Total duration | 376.54 s | 411.40 s | ratio 109.26%; failed |

The Codex observation rejects a simultaneous accuracy, token, and duration gain. Faster in-process search did not accelerate the provider path because retrieval was a small part of total work and selected whole-document bytes did not shrink.

## Claude observations

The first scheduled Claude observation used an invalid read-only permission coordinate and failed during adapter startup in 0–5 ms, with zero provider calls and zero usage. This was a harness failure, not a model or engine result. The corrected observation used the required `plan` mode with an empty tool set.

The corrected Claude `opus` observation attempted all 48 independent sessions. Parsing accepted only 3/24 lexical-v1 and 6/24 lexical-v2 observations; the other 21 and 18 arms failed with `provider_result_invalid`. Usage was consequently available for only 3 and 6 arms. Total observed duration was 904.85 seconds for lexical-v1 and 976.38 seconds for lexical-v2, a ratio of 107.91%.

Incomplete usage makes token totals and quality averages ineligible for comparison. Claude failed the provider-contract, usage-completeness, token-evidence, and duration gates. Future provider measurement must bind the same native JSON schema carrier for Codex and Claude before making another engine-effect claim.

## Decision and diagnosis

- Keep `lexical-v1` operational and preserve explicit rollback.
- Keep lexical-v2 registered only as an inert evaluation candidate. Do not activate it or claim token, speed-and-accuracy, or cross-language gains.
- Preserve the local reports as evidence that the inverted-index ensemble can improve rank and warm-query latency; its build cost and case regressions remain unresolved.
- Do not require a retriever alone to prove token reduction while it delivers the same number of whole documents. Treat section-scoped evidence selection or loss-bounded compression as a separate observable stage with independent recall and provider gates.
- Address cross-language semantic gaps with a separately identified multilingual retriever or explicit query-projection stage. Character n-grams are an identifier and spelling fallback, not a translation mechanism.
- Require a native structured-output carrier before the next paired Claude measurement.

## Reproduction

```sh
pnpm evaluation:search-engine:run -- --suite benchmarks/search/repository-retrieval-v1.json --candidate lexical-v2 --summary
pnpm evaluation:search-engine:run -- --suite benchmarks/search/korean-repository-retrieval-v1.json --candidate lexical-v2 --summary
pnpm evaluation:lexical-v2-provider:run -- --provider codex --model gpt-5.6-sol
pnpm evaluation:lexical-v2-provider:run -- --provider claude --model opus
```

These commands are observations. They do not activate an engine, infer provider use beyond telemetry, or authorize external data transfer.

## Related decisions

- [Replacement and composition](../../../decisions/search/engines/0306-separate-search-engine-replacement-and-composition.md)
- [Lexical-v2 disposition](../../../decisions/search/engines/0307-revise-lexical-v2-after-local-and-provider-evaluation.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)

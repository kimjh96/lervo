# Lexical-assisted repository retrieval v2

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can lexical assistance preserve relevant recommendations and direct-model retrieval quality while reducing provider work by allowing repository exploration only for a provider-named evidence gap?

## Pre-registered decision contract

The checked-in suite required lexical-assisted v2 to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to the contemporaneous model-direct arm in pass count and exact expected-path recall;
- use no more than 85% of model-direct observed total tokens and 95% of model-direct wall duration;
- have no worse no-hit p95 duration or latency standard deviation than model direct;
- produce no provider-contract or evidence-gap contract failures; and
- drop no lexical recommendation intersecting the exact expected evidence set.

Failure of any criterion rejected v2. Confidence was recorded but did not affect verdicts. Token usage is a provider observation, not billed cost. The grounded-answer verdict covers only exact expected paths, abstention, recommendation preservation, and observable evidence-gap behavior; it is not semantic answer judgment or proof of provider understanding.

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight verification-authored cases covered ordinary implementation, terse “do OO,” historical rationale, impact, and approval or ownership boundaries. Each of three arms ran three times per case in independent sessions, yielding 72 accepted provider turns. Arm order rotated by case and repetition:

- `model_direct` received no lexical documents;
- `lexical_assisted_v1` received the top three `lexical-v1` documents and used the permissive v1 exploration protocol; and
- `lexical_assisted_v2` received the same documents, preserved expected-path recommendations, and could inspect the repository only for a typed named evidence gap. No-hit required exact code `lexical_no_hits`.

The sanitized corpus contained 281 Markdown sources. It excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated decisions. The accepted run binds:

- suite digest: `sha256:f754fceb1f5a2e15cd3627ae232a0b71590323ba0bd111d901181b4cf90d34f7`;
- protocol digest: `sha256:ccc70ddf6ec3f598d982681e99abde36a898369d6bfe07b3639540383d1e2bec`;
- corpus digest: `sha256:f6cd1c75801797b06a1f44bb99008ec7f5b8c014e6a1bb98f3b339016d25f719`;
- repository base: `4c6b948e1f9293f3744e68342b5d29f57463fd03`;
- working-tree status digest: `sha256:9228c80b555df73255ac05c42be4a7d91946278d5222c1493d424ffbd87e4ef3`; and
- raw operator-only report digest: `sha256:0ea7c9b79917e556cc9161b07c81c3de8779d24af51ad6523593a41dea67fb3a`.

The corpus was predominantly English; all queries and answers were Korean or mixed-language. The raw report and answer text stayed outside the repository and were deleted after this redacted observation was produced. This document contains no source bodies, absolute paths, or answer prose.

## Invalid preliminary attempt

A preliminary 72-turn attempt is excluded from all results. Its protocol used a free-form evidence-gap reason, while the scorer incorrectly required the entire reason to equal `lexical_no_hits`. The provider supplied the code as a prefix followed by an explanation, causing six failures to be over-counted. The excluded attempt had suite digest `sha256:4701b266d1a34e6c8d112cf15974b78495c3ac40352d01250571b8641a81c8bb` and raw report digest `sha256:1c6c0daa7682bb86fb1b4534a755140cc235f502fe2f38a90ae24b71f683cdbc`.

No threshold or observed answer was reinterpreted. Before the accepted run, the contract was corrected to separate an exact typed code from its bounded explanation and to bind the exact protocol digest in the suite. The complete 72-turn experiment was then rerun.

## Result

Lexical-assisted v2 failed six of ten pre-registered criteria. It met both resource criteria and both provider and evidence-gap contracts, and reduced broad latency. It failed repeatability, pass-count and recall non-inferiority, both no-hit latency criteria, and recommendation preservation.

| Metric | Model direct | Lexical assisted v1 | Lexical assisted v2 |
| --- | ---: | ---: | ---: |
| Grounded-answer verdicts passing | 15/24 | 13/24 | 10/24 |
| Cases passing all three repetitions | 5/8 | 4/8 | 3/8 |
| Mean expected-path recall | 79.17% | 68.75% | 60.42% |
| Mean returned-path precision | 28.64% | 37.20% | 44.44% |
| Wall duration | 1,217.100 s | 943.776 s | 660.366 s |
| Mean duration | 50.713 s | 39.324 s | 27.515 s |
| Duration p50 | 43.493 s | 39.965 s | 22.364 s |
| Duration p95 | 121.441 s | 58.776 s | 49.985 s |
| No-hit duration p50 | 34.978 s | 49.498 s | 35.403 s |
| No-hit duration p95 | 43.069 s | 58.776 s | 49.985 s |
| No-hit latency standard deviation | 4.896 s | 7.887 s | 9.361 s |
| Completed repository commands | 94 | 50 | 21 |
| Observed total tokens | 3,891,666 | 2,753,328 | 1,350,916 |
| Provider-contract failures | 0 | 0 | 0 |
| Evidence-gap contract failures | N/A | N/A | 0 |
| Dropped relevant recommendations | N/A | N/A | 1 |

Relative to model direct, v2 used 65.29% fewer tokens, took 45.74% less wall time, issued 77.66% fewer repository commands, reduced p50 by 48.58%, reduced p95 by 58.84%, and improved precision by 15.80 percentage points. It also produced five fewer passing observations, two fewer fully repeatable cases, 18.75 percentage points lower recall, 16.06% worse no-hit p95, and 91.21% higher no-hit latency standard deviation.

Relative to contemporaneous permissive lexical-assisted v1, v2 used 50.94% fewer tokens, took 30.03% less wall time, issued 58.00% fewer commands, reduced p50 by 44.04%, reduced p95 and no-hit p95 by 14.96%, and improved precision by 7.25 percentage points. It had three fewer passing observations, one fewer fully repeatable case, 8.33 percentage points lower recall, 18.69% higher no-hit latency standard deviation, and one dropped relevant recommendation.

Historical bounded-fallback v1 used 93.33% of direct tokens and 105.11% of direct duration. V2 used 34.71% and 54.26%, improving those ratios by 58.62 and 50.85 percentage points. This comparison is descriptive only because v2 changed the suite, corpus, repetitions, and repository snapshot. Its lower pass rate means the resource gains reverse neither rejection.

## Failure diagnosis

The narrower trigger removed broad mandatory exploration but trusted incomplete lexical bundles whenever the provider did not identify a gap:

- Node-fleet impact retained the recommended fleet roadmap, missed the required architecture source in all three v2 repetitions, and performed no repository inspection.
- Fuzzy-merge retained the recommended human-conflict source, missed the cross-provider exact-merge decision in all three repetitions, and performed no inspection.
- The user-owned-block case missed the exact execution specification in every arm and repetition, showing a suite-wide discovery weakness rather than a v2-only regression.
- The terse release case found only half the exact source set in all three v2 repetitions. One repetition named a gap and inspected the repository but omitted the relevant recommended release decision, causing the sole preservation failure.
- Of two no-hit phrasings, one passed all three v2 repetitions and the other passed only one. All six v2 no-hit runs met the typed-gap and inspection contract, but their p95 and standard deviation remained worse than direct.

Provider-named gaps sharply bounded work, but the provider often did not identify a gap when the supplied bundle was incomplete. A trigger based on self-declared incompleteness cannot yet preserve recall.

## Decision

Reject lexical-assisted v2 and do not activate it in managed execution. Keep `lexical-v1` operational. The v2 runner and suite remain a negative, reproducible baseline, not a dormant runtime policy.

Any later candidate must be a new pre-registered experiment. It must address unrecognized bundle incompleteness and no-hit variance without reintroducing question-category routing, relaxing these thresholds, treating confidence as completeness, or silently activating managed provider calls. Human review remains required before provenance promotion, production-quality claims, or activation.

See [ADR-0238](../../decisions/search/0238-evaluate-evidence-gap-lexical-assistance-v2.md), the [bounded fallback v1 observation](bounded-retrieval-fallback-v1.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

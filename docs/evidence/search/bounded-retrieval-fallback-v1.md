# Bounded repository retrieval fallback v1

Status: `observed_rejected`
Observation date: 2026-08-27

## Question

Can a lexical-first policy preserve direct model retrieval quality while reducing provider usage and latency by invoking repository exploration only for lexical no-hits, impact questions, and approval or ownership boundaries?

## Pre-registered decision contract

The checked-in suite required bounded fallback to:

- pass both repetitions for at least six of eight cases;
- be non-inferior to the contemporaneous model-direct arm in pass count and expected-path recall;
- use no more than 85% of model-direct observed total tokens;
- use no more than 95% of model-direct wall duration; and
- produce no provider-contract or fallback-trigger failures.

Failure of any criterion rejected v1. Token usage is a provider observation, not billed cost.

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. All arms used independent sessions, the same sanitized repository snapshot, public queries, exact expected paths, and read-only tools:

- `model_direct` received the base retrieval protocol without recommended documents;
- `lexical_assisted` received the top three `lexical-v1` documents when available and could inspect the repository when useful;
- `bounded_fallback` received the same lexical documents and required repository inspection for a lexical no-hit or an impact, approval, or ownership-verification trigger.

Eight verification-authored cases covered task start, historical rationale, status and impact, and approval or ownership boundaries. Each arm ran twice per case, producing 48 provider turns. Arm order rotated by case and repetition. Exact expected-path coverage determined an answer pass. A triggered fallback also required an observed completed repository command or tool call.

The sanitized corpus contained 263 Markdown sources and excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and the evaluated decision to prevent answer leakage. The accepted run binds:

- executed suite digest: `sha256:da080fff002d9f9ee086f5125a03a4b19dce94b7b0dd0f5e9c5a7b646a3bdd62`;
- corpus digest: `sha256:2a98791084cba8c1318fcf1a01d15836cd179bb075fcd92047af6b98633fa7eb`;
- repository base: `bd8f5c7c994078558c6bfc2de2decbdf0463c960`;
- working-tree status digest: `sha256:bde87c972582a12964eea53345fb7c49f6cf47abf3475537aeb143b4711ea067`; and
- raw operator-only report digest: `sha256:bd88e34b75c627992a0f24abed3e6cc64ba7c56661525fa2bcf807fc60d07f3a`.

The checked-in suite later added ADR-0227 to its self-exclusion list and has digest `sha256:a5e180bc87d2fdefa8ce2d499e685da5568c8d3c37f0540dc9c2390123c5ef45`. ADR-0227 did not exist during execution, so this changed only the suite source digest, not the executed corpus, cases, recommendations, repetitions, or verdicts.

The raw report and answer text remained outside the repository and were deleted after this redacted observation was produced. This document contains no source bodies, absolute paths, or answer prose.

## Result

Bounded fallback failed four of seven pre-registered criteria.

| Metric | Model direct | Lexical assisted | Bounded fallback |
| --- | ---: | ---: | ---: |
| Observations passing exact expected paths | 12/16 | 13/16 | 11/16 |
| Cases passing both repetitions | 6/8 | 6/8 | 5/8 |
| Mean expected-path recall | 78.13% | 84.38% | 78.13% |
| Mean returned-path precision | 29.79% | 39.93% | 35.37% |
| Wall duration | 721.130 s | 795.361 s | 757.956 s |
| Mean duration | 45.071 s | 49.710 s | 47.372 s |
| Completed repository commands | 53 | 22 | 45 |
| Observed total tokens | 2,367,706 | 1,241,535 | 2,209,716 |
| Mean observed total tokens | 147,982 | 77,596 | 138,107 |
| Provider-contract failures | 0 | 0 | 0 |
| Fallback-trigger failures | N/A | N/A | 0 |

Relative to model direct, bounded fallback used 93.33% of tokens and 105.11% of wall duration. It missed both resource thresholds, passed one fewer observation, and passed both repetitions for only five cases. Recall tied model direct; all trigger and provider contracts passed.

Lexical assisted used 52.44% of model-direct tokens and passed one more observation but took 110.29% of model-direct duration. One 193.511-second no-hit run materially affected the total. This was not strict lexical-only execution: the base protocol allowed autonomous repository inspection when recommendations were absent or insufficient, and the arm issued 22 repository commands.

## Trigger diagnosis

| Trigger group | Arm | Passes | Recall | Duration | Tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| Two lexical-only cases, repeated | Model direct | 4/4 | 100.00% | 143.203 s | 504,143 |
| Two lexical-only cases, repeated | Lexical assisted | 4/4 | 100.00% | 84.330 s | 112,809 |
| Two lexical-only cases, repeated | Bounded fallback | 4/4 | 100.00% | 77.863 s | 112,568 |
| Three lexical no-hit variants, repeated | Model direct | 6/6 | 100.00% | 241.500 s | 698,439 |
| Three lexical no-hit variants, repeated | Lexical assisted | 6/6 | 100.00% | 478.138 s | 740,628 |
| Three lexical no-hit variants, repeated | Bounded fallback | 6/6 | 100.00% | 250.739 s | 797,089 |
| Three mandatory-verification cases, repeated | Model direct | 2/6 | 41.67% | 336.427 s | 1,165,124 |
| Three mandatory-verification cases, repeated | Lexical assisted | 3/6 | 58.33% | 232.893 s | 388,098 |
| Three mandatory-verification cases, repeated | Bounded fallback | 1/6 | 41.67% | 429.354 s | 1,300,059 |

Mandatory independent verification caused the negative result. For the Node-fleet question, `lexical-v1` recommended the expected fleet roadmap, but bounded fallback omitted it in both repetitions while exploring related sources. For fuzzy merge, bounded fallback recovered both expected decisions in only one repetition; lexical assisted did so twice. All arms missed the exact execution specification in both user-owned-block repetitions.

The no-hit trigger was accurate but did not reduce model work: bounded fallback matched direct quality while using 14.12% more tokens and 3.83% more time. The two lexical-only cases showed a useful low-cost path, but six of eight cases invoked exploration, overwhelming those savings.

## Decision

Reject mandatory bounded fallback v1 and do not activate it in managed execution. The observation disproves the claim that this trigger policy preserves direct-model quality while materially reducing both usage and latency on this suite.

Keep `lexical-v1` operational. Preserve lexical recommendations as hints and optional provider exploration already allowed by the retrieval protocol. This run does not establish a production policy because the cases remain `verification_authored` and `pending_human_review`, and only one model-provider pair was measured.

A v2 experiment must be a new pre-registered policy, not a relaxed reading of this result. It should retain recommended expected paths during verification, target an explicit evidence gap instead of broadly requiring independent exploration, and separately address no-hit latency variance. It must again compare against contemporaneous direct and lexical-assisted arms.

See [ADR-0226](../../decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md) and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

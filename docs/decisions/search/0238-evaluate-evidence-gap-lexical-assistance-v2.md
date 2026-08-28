# ADR-0238: Evaluate evidence-gap lexical assistance v2

Status: `accepted`

## Context

Bounded fallback v1 required independent repository inspection for no-hits, impact questions, and approval or ownership boundaries. Repeated comparison showed that it lost relevant lexical recommendations, passed fewer observations than model direct, missed the 85% token target, and was slower than direct. The contemporaneous lexical-assisted arm used fewer observed tokens and passed more observations than direct, but its permissive exploration protocol caused high no-hit latency variance.

Question category is therefore too broad an exploration trigger. Confidence cannot establish evidence completeness, and evaluation results must not silently activate provider calls.

## Decision

Pre-register `lexical-assisted-v2` as an evaluation-only policy. Preserve every supplied lexical recommendation that intersects the exact expected evidence set. Permit read-only repository exploration only when the provider's structured result identifies a concrete evidence gap with a typed code and bounded explanation. A lexical no-hit requires the exact code `lexical_no_hits`.

Fail the v2 grounded-answer verdict for any observed inspection without a named gap, named gap without observed inspection, or dropped relevant recommendation. Bind the suite to the exact protocol digest to prevent provider-instruction drift between repetitions.

Cover ordinary implementation, terse “do OO,” historical rationale, impact, and approval or ownership boundaries. Run model direct, permissive lexical-assisted v1, and lexical-assisted v2 three contemporaneous times per case against one sanitized repository snapshot and one explicit model, rotating arm order.

Retain v1's acceptance requirements:

- At least six repeatable cases.
- Non-inferior pass count and recall.
- A maximum 85% token ratio.
- A maximum 95% duration ratio.
- Zero provider-contract failures.

Additionally require v2 to have no worse no-hit p95 or latency standard deviation than direct, zero evidence-gap contract failures, and zero dropped relevant recommendations. The deterministic grounded-answer verdict covers exact expected paths and these observable contracts; it is neither semantic answer judgment nor evidence of provider understanding.

## Consequences

The repeated experiment rejected v2. Across 24 observations per arm, model direct passed 15, permissive lexical-assisted v1 passed 13, and v2 passed 10. V2 used 34.71% of direct tokens and 54.26% of direct duration, but passed every repetition for only three cases, lost one relevant recommendation, and recorded no-hit p95 and latency standard deviation at 116.06% and 191.21% of direct, respectively.

Do not activate v2. `lexical-v1` remains the operational search engine. Production-quality and activation claims still require human review and separately reviewed activation evidence. Raw answers existed only in owner-only temporary reports and were moved to system trash after redaction. The repository retains only redacted metrics, content digests, commands, and failure meanings. See the [redacted observation](../../evidence/search/lexical-assisted-v2.md).

## Verification

- Suite validation rejects self-influence, lexical-result drift, missing request-style coverage, and insufficient no-hit samples.
- Focused tests cover evidence-gap parsing, recommendation drift, and no-hit variance acceptance.
- The repeated report binds the suite, corpus, repository snapshot, provider, model, repetitions, privacy, and exact pre-registered criteria.
- Repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks remain required.

# Diagnostic claim-coverage provider-shadow v13

Status: `rejected`
Date: 2026-08-29

## Result

V13 completed all 32 authorized fresh paired calls: 16 Codex and 16 Claude observations across four reviewed, unambiguous cases and four repetitions. Every pair had identical request and candidate-envelope digests. There were no unavailable observations, selection-grammar violations, retries, replacements, replay mismatches, privacy failures, or primary-effect differences.

Codex passed every unchanged gate with 100% recall, 86.46% mean precision, and 50% minimum per-observation precision. Claude retained 100% recall and 75.42% mean precision but failed the 50% per-observation precision gate: `implementation_release` repetition four selected five sources, including three unexpected sources, for 40% precision.

V13 is rejected without retry or threshold change. It does not reclassify the rejected v12 result and authorizes no canary design or activation.

## Provider measurements

| Provider | Observations | Mean duration | Recall | Mean precision | Minimum precision | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 16 | 11.013 s | 100% | 86.46% | 50% | 680,119 | 175,426 of 1,482,580 bytes | 88.17% | Passed |
| Claude | 16 | 45.503 s | 100% | 75.42% | 40% | 720,746 | 229,067 of 1,482,580 bytes | 84.55% | Failed per-observation precision |

Claude took 728.053 seconds versus Codex's 176.204 seconds: 4.1319 times the Codex duration, with 5.97% more reported total tokens. Provider-reported token estimates are neither billing data nor directly comparable across providers.

## Case evidence

| Case | Codex | Claude |
| --- | --- | --- |
| `implementation_release` | Four observations at 100% recall; 79.17% mean precision; 11 selections with three unexpected | Four observations at 100% recall; 55.84% mean precision; 15 selections with seven unexpected; one observation at 40% precision |
| `terse_release` | Four observations at 100% recall; 66.67% mean precision; 12 selections with four unexpected | Four observations at 100% recall; 66.67% mean precision; 12 selections with four unexpected |
| `rationale_hybrid_search` | Four exact one-source selections at 100% recall and precision | Four exact one-source selections at 100% recall and precision |
| `boundary_fuzzy_merge` | Four exact two-source selections at 100% recall and precision | Four observations at 100% recall; 79.17% mean precision; 11 selections with three unexpected |

The claim-coverage protocol preserved complete reviewed-source recall for both providers. Codex met every precision gate. Claude's redundancy was concentrated in implementation release and fuzzy merge, and one implementation-release observation crossed the pre-registered failure threshold.

## Diagnostic and cumulative interpretation

V13 exercised no selection failure, so no valid observation required `selectionViolationCodes`. Focused tests still verify the bounded diagnostic path, but this run did not activate it. V12's unclassified grammar failure remains part of the cumulative history and is not replaced by v13 completion.

Across v2-v13, 121 calls occurred against a cumulative authorization ceiling of 187. The 66 unmade calls are 35.29% of that ceiling. No billed-cost saving is claimed.

The prepared manifest digest is `sha256:806c8c83f9a99ee9de08969a7c54935b10d121027a9e5eb0ff12c328df74b376`. V13 is immutable and rejected. A successor requires a separately reviewed, provider-neutral diagnosis of Claude's redundant selection before any new provider call.

## References

- [ADR-0268](../../../decisions/search/activation/0268-diagnose-and-confirm-claim-coverage-v13.md)
- [ADR-0267](../../../decisions/search/activation/0267-retain-bounded-selection-violation-codes.md)
- [V12 evidence](linked-evidence-provider-shadow-pilot-v12.md)
- [Exact v13 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v13.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)

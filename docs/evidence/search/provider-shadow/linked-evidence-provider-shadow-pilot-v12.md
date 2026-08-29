# Four-case claim-coverage provider-shadow v12

Status: `stopped_rejected`
Date: 2026-08-29

## Result

V12 stopped without retry after 17 of 32 authorized calls. It retained 16 valid observations covering all four repetitions of `implementation_release` and `terse_release`, then recorded one unavailable Codex observation for the first `rationale_hybrid_search` repetition. The Codex turn completed, but its result violated the exact-token selection grammar, producing bounded code `provider_shadow_selection_invalid`.

The run made nine Codex and eight Claude calls. Request and candidate-envelope digests matched for every completed pair. Valid observations had no adapter transport, usage, replay, privacy, or primary-effect differences. The unavailable observation reached `turn_completed`, retained all provider and adapter coordinates, and exposed no raw provider result.

V12 is rejected because it did not meet the complete 32-observation population and zero-invalid-result gate. It cannot resume or retry and authorizes no canary design or activation.

## Partial measurements

These values cover only the eight valid observations per provider before the stop and do not constitute a full v12 provider gate.

| Provider | Valid observations | Unavailable | Mean duration | Recall on valid observations | Mean precision | Total tokens | Selected bodies | Disposition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 8 | 1 | 15.611 s | 100% | 70.84% | 327,431 | 117,114 bytes | Failed unavailable-result gate |
| Claude | 8 | 0 | 49.271 s | 100% | 64.59% | 317,662 | 112,009 bytes | Incomplete; partial mean precision below 65% |

Across eight complete pairs, Claude took 394.164 seconds versus Codex's 124.891 seconds: 3.1561 times the Codex duration. Claude reported 2.98% fewer total tokens. Provider-reported token estimates are neither billing data nor directly comparable across providers.

The controller's byte-ratio denominator includes the unavailable Codex candidate envelope, so comparable savings are not published. Valid observations dropped no reviewed relevant source.

## Completed case evidence

| Case | Codex | Claude |
| --- | --- | --- |
| `implementation_release` | Four observations at 100% recall; 66.67% mean precision; 13 selections | Four observations at 100% recall; 62.50% mean precision; 13 selections |
| `terse_release` | Four observations at 100% recall; 75% mean precision; 11 selections | Four observations at 100% recall; 66.67% mean precision; 12 selections |

The claim-coverage protocol again removed the v10 Codex recall failure on terse release and increased implementation-release selections. Claude's combined precision for only these two cases was 64.59%, just below the full-population mean gate. Later exact cases could have changed that mean, but unexecuted observations cannot be inferred or counted.

## Failure meaning and next boundary

The bounded evidence proves only that Codex returned a result rejected by the exact-token parser after a completed turn. Because raw output is intentionally not retained, the record cannot distinguish prose, malformed or unknown markers, duplication, or another grammar violation. Repeating the confirmation until it passes would create success-selection bias and is unauthorized.

[ADR-0267](../../../decisions/search/activation/0267-retain-bounded-selection-violation-codes.md) enables future observations to retain only parser-owned violation codes, never raw output. It does not retroactively classify v12 or authorize another provider call. V12 remains immutable and rejected. Managed context, canary traffic, direct terminals, operational search, and production activation remain unchanged.

## Budget

V12 used 17 calls and left 15 authorized calls unmade. Across v2-v12, 89 calls occurred against the cumulative authorization ceiling of 155, leaving 66 uncalled, or 42.58% of the ceiling. No billed-cost saving is claimed.

The prepared manifest digest is `sha256:9fbf75fef5de53e456437e091c0f2c61b45d7fd91a37cccbcaae9397dfac2324`.

## References

- [ADR-0266](../../../decisions/search/activation/0266-confirm-claim-coverage-over-four-cases-v12.md)
- [ADR-0267](../../../decisions/search/activation/0267-retain-bounded-selection-violation-codes.md)
- [V11 evidence](../linked-evidence-provider-shadow-pilot-v11.md)
- [Exact v12 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v12.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)

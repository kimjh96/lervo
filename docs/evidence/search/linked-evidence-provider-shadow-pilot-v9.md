# Paired minimal-sufficient provider-shadow v9

Status: `complete_rejected`
Date: 2026-08-29

## Result

V9 completed all 12 authorized fresh paired observations: six Codex and six Claude observations over the same six repetition-four source samples. Each pair had identical request and candidate-envelope digests. All adapter, carrier, usage, replay, privacy, and no-effect checks passed, but both providers failed the unchanged accuracy gate.

Codex achieved 75% mean precision and 66.67% mean recall; Claude achieved 72.22% mean precision and 83.33% mean recall. Both had minimum per-case precision and recall of zero. The provider-neutral minimal-sufficiency refinement corrected the earlier mean-precision problem but removed required evidence in some cases, so it does not authorize the 24-by-24 measurement.

## Provider measurements

| Provider | Observations | Mean duration | Mean recall | Mean precision | Total tokens | Selected bodies | Body-byte reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 6 | 8.625 s | 66.67% | 75% | 265,027 | 56,854 of 604,380 bytes | 90.59% |
| Claude | 6 | 41.274 s | 83.33% | 72.22% | 314,819 | 106,946 of 604,380 bytes | 82.30% |

Claude took 4.7854 times the Codex duration and reported 18.79% more total tokens. Its recall was 16.66 percentage points higher and precision 2.78 percentage points lower. These are valid same-input paired micro-pilot measurements, but the six-case population is too small and both providers failed activation accuracy.

Codex selected 9 of 76 candidates; Claude selected 14 of 76. No observation was unavailable, and there were no replay mismatches, privacy failures, or primary-effect differences.

## Case evidence

- `implementation_release`: Codex selected the exact two reviewed sources; Claude selected both plus one unexpected source.
- `terse_release`: Claude selected both reviewed sources; Codex selected one of two.
- `rationale_hybrid_search`: both selected the exact reviewed source.
- `status_node_fleet`: Claude selected both reviewed sources plus one unexpected source; Codex selected one reviewed and one unexpected source.
- `boundary_fuzzy_merge`: both selected the exact two reviewed sources.
- `boundary_user_owned_block`: neither selected the single reviewed source. Both selected the accepted managed-block decision; Claude also selected architecture and repository-knowledge specification sources.

The last two failures expose a ground-truth audit boundary. Some unexpected selections directly support the request, but provider output cannot revise human-reviewed truth. Before another adaptive provider experiment, an independent human review must classify those documents as acceptable alternatives, supporting-only sources, or genuine false positives. This audit does not change the true Codex omission for `terse_release`.

[ADR-0263](../../decisions/search/activation/0263-require-blind-human-ground-truth-audit-after-v9.md) generated a complete provider-blind packet covering all 29 candidates across those two cases. The packet remains `awaiting_independent_human_review`; it changed no ground truth and authorized no provider calls.

[ADR-0264](../../decisions/search/activation/0264-measure-only-unambiguous-provider-shadow-cases-v10.md) retained the incomplete packet but removed it as an activation prerequisite. V10 excluded both ambiguous cases from its numerator and denominator without revising v9 or its ground truth.

## Budget and disposition

V9 used all 12 authorized calls without retries. Across v2-v9, 24 calls occurred against the cumulative ceiling of 75, leaving 51 uncalled (68% of the ceiling). No billed-cost saving is claimed.

V9 is immutable and rejected. A 24-by-24 paired measurement, managed-context canary, direct-terminal change, and production activation remain unauthorized.

## References

- [ADR-0262](../../decisions/search/activation/0262-test-minimal-sufficient-paired-provider-selection-v9.md)
- [Exact v9 overlay](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v9.json)
- [Prior Codex-Claude report](codex-claude-linked-evidence-measurement-report.md)
- [Blind ground-truth audit packet evidence](linked-evidence-provider-shadow-v9-ground-truth-audit.md)
- [V10 unambiguous paired evidence](linked-evidence-provider-shadow-pilot-v10.md)

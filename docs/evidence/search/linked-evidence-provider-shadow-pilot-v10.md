# Unambiguous paired provider-shadow v10

Status: `complete_rejected`
Date: 2026-08-29

## Result

V10 completed all 32 authorized fresh paired observations: 16 Codex and 16 Claude observations across four reviewed unambiguous cases and all four immutable nonempty phase-A repetitions. Every one of the 16 pairs had identical request and candidate-envelope digests. All adapter, carrier, usage, replay, privacy, and no-effect checks passed.

Claude passed its complete provider gate with 100% recall across all 16 observations and 89.58% mean precision. Codex failed with 81.25% mean recall despite 97.92% mean precision. It omitted one of two reviewed sources in all four `terse_release` observations and in two of four `boundary_fuzzy_merge` observations. Because both providers must pass, v10 is rejected and authorizes no canary design or activation.

## Population and exclusions

The evaluated population contains `implementation_release`, `terse_release`, `rationale_hybrid_search`, and `boundary_fuzzy_merge`, with four observations per case and provider. `status_node_fleet` and `boundary_user_owned_block` are excluded from both numerator and denominator without reclassification. Their ADR-0263 audit packet remains incomplete and is not evidence of correctness.

An initial provider-free prepare attempt assumed five repetitions and failed with `provider_shadow_manifest_drift`. Inspection established that the immutable nonempty phase-A population contains four repetitions per selected case. The corrected exact contract prepared 16 source samples; no provider call occurred before the correction.

## Provider measurements

| Provider | Observations | Mean duration | Mean recall | Mean precision | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 16 | 8.100 s | 81.25% | 97.92% | 676,964 | 120,927 of 1,482,580 bytes | 91.84% | Failed recall |
| Claude | 16 | 37.527 s | 100% | 89.58% | 811,336 | 163,135 of 1,482,580 bytes | 89.00% | Passed |

Claude took 600.435 seconds versus Codex's 129.601 seconds, 4.6330 times the Codex duration, and reported 19.85% more total tokens. Its recall was 18.75 percentage points higher and precision 8.34 percentage points lower. Codex selected 23 of 188 candidates; Claude selected 33 of 188.

## Case evidence

| Case | Codex recall observations | Claude recall observations | Disposition |
| --- | --- | --- | --- |
| `implementation_release` | 4/4 at 100% | 4/4 at 100% | Both complete; Codex had one and Claude four unexpected selections |
| `terse_release` | 0/4 at 100%; all four at 50% | 4/4 at 100% | Repeatable Codex omission |
| `rationale_hybrid_search` | 4/4 at 100% | 4/4 at 100% | Both selected the exact single source every time |
| `boundary_fuzzy_merge` | 2/4 at 100%; two at 50% | 4/4 at 100% | Intermittent Codex omission |

Codex dropped six reviewed relevant recommendations: four in `terse_release` and two in `boundary_fuzzy_merge`. Claude dropped none. No observation was unavailable. There were no replay mismatches, privacy failures, primary-effect differences, or missing usage records.

## Budget and disposition

V10 used exactly 32 calls without retry: 16 Codex and 16 Claude. Across v2-v10, 56 calls occurred against the cumulative authorization ceiling of 107, leaving 51 uncalled. No billed-cost saving is claimed because SDK usage is not billing data.

The prepared manifest digest is `sha256:1b4625184140561d7bef719792681785ad1928698d47546c4ab210af4e23ade5`. V10 is immutable and rejected. Operational search, managed context, direct terminals, canary traffic, and production activation remain unchanged.

## References

- [ADR-0264](../../decisions/search/activation/0264-measure-only-unambiguous-provider-shadow-cases-v10.md)
- [Exact v10 overlay](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v10.json)
- [Paired v9 evidence](linked-evidence-provider-shadow-pilot-v9.md)
- [Combined Codex-Claude report](codex-claude-linked-evidence-measurement-report.md)

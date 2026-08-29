# Relational-coverage provider-shadow v17

Status: `passed_diagnostic`
Date: 2026-08-29

## Result

V17 completed exactly 16 fresh calls without retry: eight Codex and eight Claude. Both providers passed every unchanged selection gate with 100% recall in every observation, at least 66.67% precision in every observation, complete usage, and zero unavailable, grammar, replay, privacy, or primary-effect failures.

| Provider | Recall | Mean precision | Minimum precision | Mean duration | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 100% | 95.83% | 66.67% | 14.990 s | 349,254 | 67,187 of 731,836 bytes | 90.82% | Passed |
| Claude | 100% | 79.17% | 66.67% | 44.510 s | 343,253 | 96,214 of 731,836 bytes | 86.85% | Passed |

Codex took 119.920 seconds in total and Claude took 356.077 seconds. Claude was 2.9693 times slower, so Codex used 66.32% less provider time. Claude reported 1.72% fewer total tokens; provider token accounting is not billing evidence and is not directly comparable.

## Case evidence

For `implementation_release`, Codex selected nine documents across four observations, with 100% recall, 91.67% mean precision, and one unexpected selection. Claude selected 12, with 100% recall and 66.67% precision.

For `boundary_fuzzy_merge`, Codex selected exactly both relevant relation sides in all four repetitions, with 100% recall and precision. Claude retained 100% recall and 91.67% mean precision with one unexpected selection. The v16 omission did not recur.

## Accounting and disposition

The prepared manifest digest is `sha256:efc38ad7e23708215ea599b53e9952f6fd5a5c492a0415086d8d005028da02a1`. Across v2-v17, 170 provider calls occurred against a cumulative authorized ceiling of 251. The 81 unmade calls are 32.27% of that ceiling.

V17 passes only the two-case diagnostic. It authorizes a separately reviewed fresh four-case confirmation, not managed context, canary traffic, operational search, or activation. Historical failed pilots remain immutable.

## References

- [ADR-0274](../../../decisions/search/activation/provider-shadow-structured/0274-test-relational-coverage-provider-shadow-v17.md)
- [Exact v17 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v17.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)

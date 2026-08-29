# Claim-coverage paired provider-shadow v11

Status: `complete_passed_diagnostic`
Date: 2026-08-29

## Result

V11 completed all 16 authorized fresh paired observations: eight Codex and eight Claude observations across the two diagnosed v10 failure cases and all four immutable nonempty phase-A repetitions. Each pair had identical request and candidate-envelope digests. All adapter, carrier, usage, replay, privacy, and no-effect checks passed.

Both providers passed every unchanged gate without dropping a reviewed relevant source. Codex achieved 100% recall and 87.50% mean precision; Claude achieved 100% recall and 83.34% mean precision. On this bounded population, claim coverage before minimization removed the v10 recall failure.

This pass authorizes only a separate design review for full four-case confirmation. It does not authorize that confirmation, managed context, canary traffic, direct-terminal changes, operational search, or production activation.

## Provider measurements

| Provider | Observations | Mean duration | Mean recall | Mean precision | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 8 | 11.381 s | 100% | 87.50% | 313,465 | 75,745 of 623,180 bytes | 87.85% | Passed |
| Claude | 8 | 41.546 s | 100% | 83.34% | 296,046 | 80,024 of 623,180 bytes | 87.16% | Passed |

Claude took 332.371 seconds versus Codex's 91.044 seconds, or 3.6507 times as long, and reported 5.56% fewer total tokens. Provider-reported token estimates are neither billing data nor directly comparable across providers.

## Case evidence

| Case | Codex | Claude | Disposition |
| --- | --- | --- | --- |
| `terse_release` | Four observations at 100% recall and 75% mean precision; 11 selections, including three unexpected | Four observations at 100% recall and 66.67% mean precision; 12 selections, including four unexpected | Recall repaired; precision remained above the unchanged gate |
| `boundary_fuzzy_merge` | Four exact two-source selections at 100% recall and precision | Four exact two-source selections at 100% recall and precision | Both complete without redundancy |

In v9 and all four v10 `terse_release` observations, Codex selected only `cli-version-management.md`; v11 selected both reviewed release sources in every repetition. Codex omitted ADR-0180 in two of four v10 fuzzy-merge observations; v11 selected ADR-0180 and ADR-0227 in all four.

The extra terse-release selections demonstrate that claim coverage trades some precision and body-byte reduction for complete recall. Both measures remained within existing thresholds; no threshold changed.

## Budget and disposition

V11 used exactly 16 calls without retry: eight Codex and eight Claude. V2-v11 used 72 calls against the cumulative authorization ceiling of 123, leaving 51 uncalled. No billed-cost saving is claimed.

The prepared manifest digest is `sha256:b0efc17bd3b90225c6132ddf9c18360958b2e225d9aa9f186d9b56ac630c8e74`. V11 is immutable and passed as a diagnostic. Full confirmation must preserve the protocol and reintroduce the other two reviewed unambiguous cases to detect recall or precision regression.

## References

- [ADR-0265](../../decisions/search/activation/0265-test-claim-coverage-before-minimization-v11.md)
- [V10 omission diagnosis](linked-evidence-provider-shadow-v10-codex-omission-diagnosis.md)
- [Exact v11 overlay](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v11.json)
- [Combined measurement report](codex-claude-linked-evidence-measurement-report.md)

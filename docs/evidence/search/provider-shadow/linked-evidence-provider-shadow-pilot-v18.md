# Relational-coverage provider-shadow v18 confirmation

Status: `passed_confirmation`
Date: 2026-08-29

## Result

V18 completed exactly 32 fresh calls without retries: 16 Codex and 16 Claude calls across four reviewed, unambiguous cases and four repetitions. Both providers passed every unchanged gate, achieving 100% recall in every observation, complete duration and usage data, and zero unavailable, grammar, replay, privacy, or primary-effect failures.

| Provider | Recall | Mean precision | Minimum precision | Mean duration | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 100% | 93.75% | 66.67% | 12.066 s | 695,878 | 154,577 of 1,482,580 bytes | 89.57% | Passed |
| Claude | 100% | 76.04% | 50.00% | 46.109 s | 737,646 | 199,152 of 1,482,580 bytes | 86.57% | Passed |

Codex took 193.063 seconds in total; Claude took 737.736 seconds. Claude was 3.8212 times slower, so Codex used 73.83% less provider time. Claude reported 6.00% more total tokens, but provider token accounting is not billing evidence and is not directly comparable.

## Case evidence

Codex retained 100% recall in all 16 observations. Mean precision was 91.67% for `implementation_release`, 83.34% for `terse_release`, and 100% for both `rationale_hybrid_search` and `boundary_fuzzy_merge`. It made three unexpected selections across the complete population.

Claude retained 100% recall in all 16 observations. Mean precision was 66.67% for both release cases, 100% for hybrid-search rationale, and 70.84% for fuzzy merge. It made 12 unexpected selections. Neither provider dropped a relevant recommendation, linked source, or coverage source.

## Accounting and disposition

The prepared manifest digest is `sha256:a00d3772f9b40ae23a7a30787eb0c2b149d19387a986307f1b91aa5655a73ff3`. Across v2-v18, 202 provider calls occurred against a cumulative authorized ceiling of 283. The 81 unmade calls are 28.62% of that ceiling.

V18 passes the fresh four-case confirmation. Together with v17, it establishes activation-design readiness for the reviewed unambiguous population and unchanged relational protocol. It does not erase historical failures or authorize managed-context effects, canary traffic, direct-terminal changes, operational search changes, or production activation.

## References

- [ADR-0276](../../../decisions/search/activation/provider-shadow-structured/0276-confirm-relational-coverage-provider-shadow-v18.md)
- [Exact v18 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v18.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)

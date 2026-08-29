# Compatible structured-carrier provider-shadow v16

Status: `rejected`
Date: 2026-08-29

## Result

V16 completed exactly 16 fresh calls without retry: eight Codex and eight Claude. Every call returned valid structured output with complete duration and usage. All replay, privacy, grammar, and primary-effect controls passed. Claude passed every provider gate. Codex failed the unchanged recall gate in one fuzzy-merge repetition; therefore, v16 is rejected and authorizes no confirmation or activation.

| Provider | Valid | Recall | Mean precision | Minimum precision | Mean duration | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 8 | 93.75% mean; 50% minimum | 100% | 100% | 13.754 s | 348,708 | 60,694 of 731,836 bytes | 91.71% | Failed recall |
| Claude | 8 | 100% | 79.17% | 66.67% | 39.667 s | 339,180 | 96,214 of 731,836 bytes | 86.85% | Passed |

Codex took 110.028 seconds in total; Claude took 317.335 seconds. Claude was 2.8841 times slower, so Codex used 65.33% less elapsed provider time. Claude reported 2.73% fewer total tokens, but provider token accounting is not directly comparable and is not billing evidence.

## Accuracy diagnosis

The `implementation_release` case was exact in all four Codex observations. Claude retained 100% recall with 66.67% precision.

For `boundary_fuzzy_merge`, Codex was exact in three repetitions. In repetition three, it selected the approval-gated fuzzy-merge decision ADR-0227 (`doc_72ff491137fc89887edbe649`) but omitted the distinct hash-bound human conflict-resolution prerequisite ADR-0180 (`doc_f50e6220a318ba83a9f075ef`). That observation had 50% recall and 100% precision. Claude retained both relevant sides in all four repetitions, with 91.67% mean precision and one unexpected selection across the case.

The miss followed identical candidate delivery. It does not implicate schema compatibility, parsing, candidate identity, order, content, or ground truth. This evidence retains no raw provider output, source body, unrestricted error, path-bearing prompt, or provider reasoning.

## Accounting and disposition

The prepared manifest digest is `sha256:ac6d569979f3dbd31e8900922555a36d68ea759f281ebc52dfdb60d2c8cb2e02`. Across v2-v16, 154 provider calls occurred against the cumulative authorized ceiling of 235. The 81 unmade calls are 34.47% of that ceiling.

V16 remains immutable and rejected. [ADR-0274](../../../decisions/search/activation/provider-shadow-structured/0274-test-relational-coverage-provider-shadow-v17.md) defines a provider-neutral relation-side preservation rule and a fresh bounded diagnostic; it does not retry or repair v16. Managed context, canary traffic, operational search, and activation remain unauthorized.

## References

- [ADR-0273](../../../decisions/search/activation/provider-shadow-structured/0273-test-compatible-structured-provider-shadow-carrier-v16.md)
- [ADR-0274](../../../decisions/search/activation/provider-shadow-structured/0274-test-relational-coverage-provider-shadow-v17.md)
- [Exact v16 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v16.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)

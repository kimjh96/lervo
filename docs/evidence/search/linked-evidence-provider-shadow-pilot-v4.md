# Codex-Claude provider-shadow final report

Status: `failed`
Observed: 2026-08-29

## Executive result

The paired provider-shadow series did not produce a valid 24-by-24 Codex-Claude comparison. Terminal v2, v3, and v4 pilots made four provider calls: one Codex call and three Claude calls. Only the v2 Codex sample was eligible. Each Claude turn completed but failed a required observation boundary. First-failure stopping prevented the remaining 47 calls under the final cumulative ceiling of 51.

No production or canary behavior changed. All attempts preserved primary managed context, output, managed writes, verification, publication, and E1-E4 event digests.

## Measurements

| Provider | Calls | Eligible observations | Valid accuracy samples | Observed duration | Observed tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex `gpt-5.6-sol` | 1 | 1 | 1 | 11.438 s | 42,902 total |
| Claude `opus` | 3 | 0 | 0 | Unavailable | Unavailable |

The Codex observation selected two of 14 candidates. Review found both relevant and none unexpected, giving 100.00% precision and recall for this single sample. Candidate count fell 85.71%, and candidate-body bytes fell 90.28%, from 97,037 to 9,427.

Codex usage was 42,496 input, 11,008 cached-input, 406 output, 267 reasoning-output, and 42,902 total tokens. Provider categories can overlap and must not be summed to reconstruct total usage.

Claude produced no eligible accuracy, duration, token, or compression observation. Missing machine-review values are absence sentinels, not zero performance. Its bounded failures were:

1. V2: aggregate result invalidity, before detailed result diagnostics existed.
2. V3: provider usage unavailable because the Claude adapter did not normalize SDK `modelUsage`.
3. V4: usage normalization passed, but strict selection was invalid because the completed output did not satisfy the exact E4-only selection grammar.

Raw Claude output was not retained, so parser relaxation or corrected post-hoc replay is impossible. The pilots are non-resumable; samples cannot be retried or borrowed.

## Conclusion

- Speed: Codex took 11.438 seconds on one valid sample. Claude has no eligible duration, so no relative speed claim is valid.
- Accuracy: Codex had 100% precision and recall on one sample. Claude has no valid accuracy samples, so no cross-provider accuracy claim is valid.
- Context reduction: the valid Codex selection reduced selected-body bytes by 90.28%. This is potential downstream context reduction; it did not reduce the completed selection call.
- Call avoidance: stopping used four of the cumulative 51-call ceiling, avoiding 47 calls, or 92.16%. This is avoided experimental work, not model efficiency or billed-cost savings.
- Currency: no currency saving is claimed because SDK cost estimates and provider-specific billed-price evidence were not retained.

The result is negative: the strict provider-shadow selection protocol was demonstrated for one Codex sample but is incompatible with the observed Claude adapter/model path. Canary design, managed-context activation, and production activation remain unauthorized.

## Evidence bindings

- Exact v4 contract: `sha256:08ab9c78a785d6967f0ce10c590390c05b38f99cbb807f835648571808e4f9d3`
- V4 prepared manifest: `sha256:61ed466b53b801c07c3c349e121336e6fdb9aba8925cdeee2aa07bf0eb829cb2`
- Retained v4 prepared file: `sha256:c7a07d87436dfedea1440dfb9b62f2d3ca759c88957d63b8074e1f2ad036c5fe`
- Retained v4 failed review: `sha256:05c6d1b9daf2c040ba0b5354162f188de5a7542a357f8ccef3e18c21a6fad663`
- Retained v4 Claude observation: `sha256:7af49416165bb16d8d784959abdac6bf4c1303f36d2c728404bffb4c42644654`

## References

- [ADR-0257](../../decisions/search/activation/0257-observe-claude-sdk-usage-provider-shadow-v4.md)
- [Exact v4 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v4.json)
- [V3 evidence](linked-evidence-provider-shadow-pilot-v3.md)
- [V2 evidence](linked-evidence-provider-shadow-pilot-v2.md)
- [V1 evidence](linked-evidence-provider-shadow-pilot-v1.md)

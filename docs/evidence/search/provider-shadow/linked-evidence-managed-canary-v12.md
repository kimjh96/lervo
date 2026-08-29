# Managed linked-evidence canary v12 report

Status: `complete_rejected_and_rolled_back`
Date: 2026-08-29

V12 completed all eight Codex and eight Claude task runs through native signed-in sessions. It changed only the provider-neutral E4 reference instruction, asking providers to mark documents that directly supported independently necessary substantive claims and omit documents merely read or followed as behavior or process controls. Expected document identifiers remained hidden, and scoring retained every exact current token from raw provider output without ground-truth filtering.

All 16 runs were technically successful with zero selection calls, retries, API keys, or repository mutations. The correction failed: Claude mean precision improved 15.83 percentage points from v11, but two runs remained below the unchanged 50% per-run minimum. Codex mean precision improved 10.42 points, but two terse-release runs omitted one of two expected sources, reducing mean recall by 12.5 points. The prompt-only instruction was rejected and rolled back; activation remains default-off.

## Bound evidence

- Prepared manifest digest: `sha256:428bb356f2a51d5c2321af454ad451310fd6c6e1e35769fa34c6f4cbd26b35b0`
- Observation-set digest: `sha256:5d746c18c28182a71e22234d16eeff936b49b63e3cb32bbe93389e377812be9c`
- Completed runs: 16 of 16
- Technical failures: 0
- Task provider calls: 16
- Selection provider calls: 0
- User API keys: 0
- Retries, repairs, and replacement runs: 0
- Repository mutations: 0

## Provider results

| Provider | Runs | Mean / median duration | Mean / minimum recall | Mean / minimum precision | Recall failures | Precision failures | Reported total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex `gpt-5.6-sol` | 8 | 156.128 / 153.033 s | 87.5% / 50% | 91.67% / 66.67% | 2 | 0 | 8,500,004 |
| Claude `opus` | 8 | 97.657 / 95.936 s | 100% / 100% | 65.97% / 22.22% | 0 | 2 | 1,007,488 |

Claude mean duration was 37.45% lower than Codex mean duration. Provider token accounting is not directly comparable and does not establish billed cost.

Relative to v11, Codex mean duration increased 12.29%, mean precision increased 10.42 percentage points, and mean recall fell 12.5 points. Claude mean duration increased 11.33%, mean precision increased 15.83 points, and mean recall was unchanged. Reported total tokens decreased 2.05% for Codex and 26.62% for Claude, but provider-reported totals are neither billing data nor a controlled token-cost estimate.

Deterministic selection again removed all 16 selection calls from the reviewed two-stage ceiling and reduced total provider calls from 32 to 16. The defensible savings are a 100% selection-call reduction and 50% total-provider-call reduction. No monetary saving is claimed.

## Activation gates

| Gate | Required | Observed | Result |
| --- | --- | --- | --- |
| Completed runs | 16 | 16 | Pass |
| Technical failures | 0 | 0 | Pass |
| Selection calls | 0 | 0 | Pass |
| Source recall per run | 100% | Codex had 2 runs at 50% | Fail |
| Reference precision per run | At least 50% | Claude had 2 runs at 22.22% | Fail |
| Mean precision per provider | At least 65% | Codex 91.67%; Claude 65.97% | Pass |
| Repository mutation | None | Before/after digest identical in all 16 | Pass |
| User API keys | None | None | Pass |

## Disposition

Preserve v12 as terminal negative evidence without retry or reclassification. Reject and roll back the prompt-only E4 constraint. Keep the managed linked-evidence feature default-off.

The observations expose a structural ambiguity: task evidence and governance or instruction documents reach the provider through the same envelope document shape and evidence-token rule. Stronger prose cannot reliably make both providers infer the intended distinction. Before any fresh calls, a successor must type the document role in the provider-neutral delivery contract and common adapter tests. It must not expose expected evaluation identifiers or filter observed provider output.

## References

- [V12 prompt-only decision](../../../decisions/search/activation/provider-shadow-structured/0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md)
- [V12 rejection and rollback](../../../decisions/search/activation/provider-shadow-structured/0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md)
- [V11 terminal evidence](linked-evidence-managed-canary-v11.md)
- [Full Codex-Claude measurement report](../codex-claude-linked-evidence-measurement-report.md)
- [Managed canary specification](../../../specifications/execution/managed-linked-evidence-canary.md)

# Managed linked-evidence canary v14 report

Status: `complete_with_activation_blocked`
Date: 2026-08-30

V14 completed all eight Codex and eight Claude native signed-in task runs through the provider-neutral typed context boundary. All 16 runs were technically successful, with zero selection calls, retries, API keys, writes, or repository mutations. Every run recalled every expected source.

Codex passed every accuracy gate with 100% mean recall, 87.5% mean precision, and no per-run failure. Claude achieved 100% mean recall and 60.07% mean precision. Two Claude runs referenced eight or nine task-evidence documents when only two were expected, yielding 22.22% and 25% precision. The typed boundary removes evidence tokens from governance context, but ordinary task-evidence eligibility remains broader than the evaluated claim set. V14 therefore does not authorize activation.

## Bound evidence

- Prepared manifest digest: `sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe`
- Observation-set digest: `sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7`
- Completed runs: 16 of 16
- Technical failures: 0
- Task provider calls: 16
- Selection provider calls: 0
- User API keys: 0
- Retries, repairs, and replacement runs: 0
- Repository mutations: 0

## Provider results

| Provider | Runs | Mean / median duration | Min / max duration | Mean / minimum recall | Mean / minimum precision | Recall / precision failures | Reported total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex `gpt-5.6-sol` | 8 | 144.251 / 116.906 s | 68.919 / 249.978 s | 100% / 100% | 87.5% / 66.67% | 0 / 0 | 9,656,366 |
| Claude `opus` | 8 | 85.013 / 84.320 s | 46.549 / 119.535 s | 100% / 100% | 60.07% / 22.22% | 0 / 2 | 954,173 |

Claude's mean duration was 41.07% lower than Codex's. Relative to v12, Codex and Claude mean durations decreased 7.61% and 12.95%, while median durations decreased 23.61% and 12.11%, respectively. Codex recovered 12.5 recall percentage points but lost 4.17 precision points. Claude's recall was unchanged, while precision fell 5.90 points.

Relative to v12, reported total tokens increased 13.60% for Codex and decreased 5.29% for Claude. Provider token accounting is not directly comparable and does not establish billed cost. Against the reviewed two-stage ceiling, deterministic selection eliminated all 16 selection calls and reduced total provider calls from 32 to 16. The defensible savings are a 100% selection-call reduction and a 50% total-provider-call reduction; no monetary saving is claimed.

## Activation gates

| Gate | Required | Observed | Result |
| --- | --- | --- | --- |
| Completed runs | 16 | 16 | Pass |
| Technical failures | 0 | 0 | Pass |
| Selection calls | 0 | 0 | Pass |
| Source recall per run | 100% | 100% in all 16 | Pass |
| Reference precision per run | At least 50% | Claude had 2 runs below 50% | Fail |
| Mean precision per provider | At least 65% | Codex 87.5%; Claude 60.07% | Fail |
| Repository mutation | None | Before/after digest identical in all 16 | Pass |
| User API keys | None | None | Pass |

## Disposition

Preserve v14 as terminal negative evidence without retry, repair, reclassification, or replacement. Keep managed linked evidence default-off. A successor must diagnose why referenceable task evidence remains broader than the evaluated claim set before changing classification or delivery. It must not expose expected identifiers, filter raw E4 observations, add provider-specific routing, or relax the accuracy gates.

## References

- [V14 execution decision](../../../decisions/search/activation/provider-shadow-structured/typed-context/0295-authorize-typed-context-managed-canary-v14.md)
- [V14 activation disposition](../../../decisions/search/activation/provider-shadow-structured/typed-context/0296-reject-activation-after-typed-context-managed-canary-v14.md)
- [V12 terminal evidence](linked-evidence-managed-canary-v12.md)
- [Full Codex-Claude measurement report](../codex-claude-linked-evidence-measurement-report.md)
- [Managed canary specification](../../../specifications/execution/managed-linked-evidence-canary.md)

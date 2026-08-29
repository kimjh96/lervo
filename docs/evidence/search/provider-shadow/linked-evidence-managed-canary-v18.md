# Managed linked-evidence canary v18 report

Status: `complete_with_activation_authorized`
Date: 2026-08-30

V18 completed all eight Codex and eight Claude native signed-in task runs through the source-current claim-eligibility boundary. All 16 runs were technically successful, with zero selection calls, retries, API keys, writes, or repository mutations. Every run recalled every expected source and passed the unchanged per-run precision floor.

Codex achieved 100% mean recall and 83.33% mean precision. Claude achieved 100% mean recall and 79.17% mean precision. V18 therefore authorizes the provider-neutral deterministic default path recorded by ADR-0301.

## Bound evidence

- Prepared manifest digest: `sha256:f3ea095953b5252abed51e4a4c89cf15d66e03377a986621497d933538d89f20`
- Observation-set digest: `sha256:51f10ca2a9bc3cbb480223f7aef587096583f2f63ad959d9dbbc344183f89e9a`
- Contract digest: `sha256:0a56ec6e2de6307ade4f64d794a148553fbaca9e23113c177cf1364413713244`
- Built CLI digest: `sha256:30c3089e2a297f2b3731190618f3be8aaacb741c25c6258361bf8f2930a95928`
- Completed runs: 16 of 16
- Technical failures: 0
- Task provider calls: 16
- Selection provider calls: 0
- User API keys: 0
- Retries, repairs, and replacement runs: 0
- Repository mutations: 0
- Observation capacity: 74 records before execution and 90 of 128 after completion
- Complete-event capacity: 4,105 of 8,192 relevant events bound at preparation; every run revalidated the complete source below the cap

## Provider results

| Provider | Runs | Mean / median duration | Min / max duration | Mean / minimum recall | Mean / minimum precision | Recall / precision failures | Reported total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex `gpt-5.6-sol` | 8 | 154.376 / 161.168 s | 89.954 / 213.289 s | 100% / 100% | 83.33% / 66.67% | 0 / 0 | 11,173,201 |
| Claude `opus` | 8 | 80.978 / 79.429 s | 52.673 / 107.935 s | 100% / 100% | 79.17% / 50% | 0 / 0 | 922,497 |

## Comparison with v14

The claim-eligibility change raised Claude mean precision by 19.10 percentage points and minimum precision by 27.78 points, eliminating both per-run precision failures. Codex mean precision decreased 4.17 points while remaining above every gate; its minimum precision and both providers' 100% recall were unchanged.

Claude mean and median duration improved by 4.75% and 5.80%. Codex mean and median duration increased by 7.02% and 37.86%. Across both providers, total observed duration increased 2.66%, from 1,834.112 to 1,882.833 seconds. This population therefore proves a Claude speed improvement, not an overall speed improvement.

Claude reported 922,497 total tokens, 3.32% below v14. Codex reported 11,173,201, 15.71% above v14. Combined provider-reported usage increased 14.00%, from 10,610,539 to 12,095,698 tokens. Token accounting differs by provider and is not billing evidence; no monetary saving is claimed.

The deterministic path made zero selection calls. Against the reviewed two-stage ceiling of 16 selection plus 16 task calls, it avoids all 16 selection calls and half of the provider-call ceiling. V14 already used the same deterministic one-stage call shape, so v18 adds no further observed call saving over v14.

Failed successor checkpoints are experiment overhead, not savings: v15 used one task call before a measurement-projection failure; v16 used 12 task calls before its observation-capacity stop; v17 used 10 task calls before a pre-provider event-capacity stop. Together they used 23 provider calls, zero selection calls, and produced no accepted complete activation population.

## Activation gates

| Gate | Required | Observed | Result |
| --- | --- | --- | --- |
| Completed runs | 16 | 16 | Pass |
| Technical failures | 0 | 0 | Pass |
| Selection calls | 0 | 0 | Pass |
| Source recall per run | 100% | 100% in all 16 | Pass |
| Reference precision per run | At least 50% | Minimum 66.67% Codex; 50% Claude | Pass |
| Mean precision per provider | At least 65% | 83.33% Codex; 79.17% Claude | Pass |
| Repository mutation | None | Before/after digest identical in all 16 | Pass |
| User API keys | None | None | Pass |
| Observation capacity | At most 128 | 90 after completion | Pass |
| Complete-event capacity | At most 8,192 and 16 MiB | Revalidated before every call | Pass |

## Disposition

Preserve v18 as terminal positive evidence. Activate only the tested provider-neutral deterministic selection shape. Keep exact canary execution separately authorized, retain all prior negative and technical-failure evidence, and continue to distinguish selected, loaded, injected, referenced, and unobservable provider use.

## References

- [Activation decision](../../../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md)
- [Event-capacity decision](../../../decisions/search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md)
- [V14 baseline](linked-evidence-managed-canary-v14.md)
- [Full Codex-Claude measurement report](../codex-claude-linked-evidence-measurement-report.md)
- [Managed canary specification](../../../specifications/execution/managed-linked-evidence-canary.md)

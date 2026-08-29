# Codex and Claude linked-evidence measurement report

Status: `complete_with_activation`
Date: 2026-08-30

## Current outcome

Managed-context v18 completed a fresh 16-run native signed-in population: eight Codex `gpt-5.6-sol` and eight Claude `opus` runs. No user API key, selection-model call, retry, write, or repository mutation occurred. Every run preserved deterministic linked selection through E1 planning, E2 loading, E3 injection, and E4 observation.

V11 achieved 100% source recall for both providers but failed Claude precision gates. V12 improved precision through a prompt-only correction but introduced Codex recall failures. V14 restored 100% recall through typed context but retained two Claude precision failures. V18 adds independent claim eligibility: linked supporting context remains selected, loaded, and injected, while only direct task evidence receives E4 reference authority. Both providers retained 100% recall. Codex reached 83.33% mean precision and Claude 79.17%, with no per-run failure. Every unchanged activation gate passed, and ADR-0301 activates the deterministic provider-neutral path.

Deterministic selection eliminates all 16 selection calls from the reviewed two-stage ceiling, reducing the call ceiling from 32 to 16: 100% selection-call avoidance and 50% total-provider-call avoidance, not a billed-cost claim. V14 already had the same one-stage shape, so v18 adds no observed call saving over v14.

## Measurements

| Version | Provider | Runs | Success | Mean / median duration | Min / max | Mean / minimum recall | Mean / minimum precision | Recall / precision failures | Mean reported tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v18 | Codex `gpt-5.6-sol` | 8 | 100% | 154.376 / 161.168 s | 89.954 / 213.289 s | 100% / 100% | 83.33% / 66.67% | 0 / 0 | 1,396,650 |
| v18 | Claude `opus` | 8 | 100% | 80.978 / 79.429 s | 52.673 / 107.935 s | 100% / 100% | 79.17% / 50% | 0 / 0 | 115,312 |
| v14 | Codex `gpt-5.6-sol` | 8 | 100% | 144.251 / 116.906 s | 68.919 / 249.978 s | 100% / 100% | 87.5% / 66.67% | 0 / 0 | 1,207,046 |
| v14 | Claude `opus` | 8 | 100% | 85.013 / 84.320 s | 46.549 / 119.535 s | 100% / 100% | 60.07% / 22.22% | 0 / 2 | 119,272 |
| v12 | Codex `gpt-5.6-sol` | 8 | 100% | 156.128 / 153.033 s | 80.731 / 270.708 s | 87.5% / 50% | 91.67% / 66.67% | 2 / 0 | 1,062,501 |
| v12 | Claude `opus` | 8 | 100% | 97.657 / 95.936 s | 34.911 / 163.349 s | 100% / 100% | 65.97% / 22.22% | 0 / 2 | 125,936 |
| v11 | Codex `gpt-5.6-sol` | 8 | 100% | 139.035 / 148.817 s | 42.912 / 197.037 s | 100% / 100% | 81.25% / 50% | 0 / 0 | 1,084,724 |
| v11 | Claude `opus` | 8 | 100% | 87.721 / 95.089 s | 50.441 / 115.845 s | 100% / 100% | 50.14% / 22.22% | 0 / 3 | 171,625 |

V18 manifest: `sha256:f3ea095953b5252abed51e4a4c89cf15d66e03377a986621497d933538d89f20`; observations: `sha256:51f10ca2a9bc3cbb480223f7aef587096583f2f63ad959d9dbbc344183f89e9a`.

V14 manifest: `sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe`; observations: `sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7`.

V12 manifest: `sha256:428bb356f2a51d5c2321af454ad451310fd6c6e1e35769fa34c6f4cbd26b35b0`; observations: `sha256:5d746c18c28182a71e22234d16eeff936b49b63e3cb32bbe93389e377812be9c`.

V11 manifest: `sha256:c7e31ff9ba22a7e0516fa383c6705c092b4e3f288004771d7a6da874afa282bc`; observations: `sha256:5c45338a70bba8ce728dff0af0c7cc71fcbfe2ccaba5cfe823e613b4756b2f9d`.

Relative to v14, v18 raised Claude mean precision 19.10 percentage points and eliminated both precision failures. Codex precision decreased 4.17 points while remaining above every gate; recall stayed 100% for both providers. Claude mean and median duration improved 4.75% and 5.80%; Codex mean and median duration increased 7.02% and 37.86%. Combined observed duration increased 2.66%. Claude reported 3.32% fewer tokens, Codex 15.71% more, and the combined provider-reported total increased 14.00%. These values are descriptive, not billed-cost evidence.

Relative to v12, v14 Claude mean duration was 41.07% below Codex's; duration fell 7.61% for Codex and 12.95% for Claude. Codex recovered 12.5 recall points while losing 4.17 precision points. Claude recall was unchanged and precision fell 5.90 points. Reported tokens rose 13.60% for Codex and fell 5.29% for Claude.

Relative to v11, v12 Claude mean duration was 37.45% below Codex's; duration rose 12.29% for Codex and 11.33% for Claude. Codex precision rose 10.42 points while recall fell 12.5 points. Claude precision rose 15.83 points with unchanged recall. Reported tokens fell 2.05% for Codex and 26.62% for Claude.

V11 reported 8,634,051 Codex input tokens, including 7,966,976 cached, plus 43,738 output tokens. Claude reported 1,325,355 input tokens, including 1,056,109 cached, plus 47,644 output tokens. In the only matched ordinal-1 Codex observation from failed managed v10, v11 reduced duration from 187.910 to 157.960 seconds (15.94%) and reported tokens from 1,421,754 to 990,071 (30.36%). This verifies improvement at the repaired boundary but does not estimate a population-wide effect. All provider-reported token values are descriptive, neither directly comparable nor billing evidence.

## Activation gates and disposition

V18 passed 16 completed runs, zero provider or technical failures, zero selection calls, identical before/after repository digests in every run, no user API keys, 100% per-run recall, at least 50% per-run precision, and at least 65% mean precision for each provider.

V11 failed because Claude had three runs below 50% precision and 50.14% mean precision, below the 65% provider threshold. V12 failed because two Codex runs had 50% recall and two Claude runs had 22.22% precision; its provider means passed the 65% threshold. V14 passed 100% per-run recall but failed because two Claude runs were below 50% precision and Claude mean precision was 60.07%, below 65%.

V15, v16, and v17 remain immutable technical-failure evidence. They incurred 1, 12, and 10 task calls respectively, totaling 23 failed-checkpoint provider calls and zero selection calls. That overhead is not counted as savings, and none of those incomplete populations supports activation.

V18 validates the provider-neutral claim-eligibility correction without exposing expected identifiers or filtering raw E4 output. ADR-0301 activates deterministic linked supporting context for ordinary managed Codex and Claude runs. The exact canary stays separately authorized; selected, loaded, injected, referenced, and unobservable provider use remain distinct.

## References

- Histories: [provider shadow](provider-shadow/codex-claude-linked-evidence-provider-shadow-history.md), [speed](provider-shadow/codex-claude-linked-evidence-speed-history.md), [savings](provider-shadow/codex-claude-linked-evidence-savings-history.md), [outcome](provider-shadow/codex-claude-linked-evidence-outcome-history.md)
- Provider-shadow evidence: [v4](linked-evidence-provider-shadow-pilot-v4.md), [v7](linked-evidence-provider-shadow-pilot-v7.md), [v8](linked-evidence-provider-shadow-pilot-v8.md), [v9](linked-evidence-provider-shadow-pilot-v9.md), [v9 audit](linked-evidence-provider-shadow-v9-ground-truth-audit.md), [v10](linked-evidence-provider-shadow-pilot-v10.md), [v10 diagnosis](linked-evidence-provider-shadow-v10-codex-omission-diagnosis.md), [v11](linked-evidence-provider-shadow-pilot-v11.md), [v12](provider-shadow/linked-evidence-provider-shadow-pilot-v12.md), [v13](provider-shadow/linked-evidence-provider-shadow-pilot-v13.md), [v14](provider-shadow/linked-evidence-provider-shadow-pilot-v14.md), [v15](provider-shadow/linked-evidence-provider-shadow-pilot-v15.md), [v16](provider-shadow/linked-evidence-provider-shadow-pilot-v16.md), [v17](provider-shadow/linked-evidence-provider-shadow-pilot-v17.md), [v18](provider-shadow/linked-evidence-provider-shadow-pilot-v18.md)
- Early ADRs: [0262](../../decisions/search/activation/0262-test-minimal-sufficient-paired-provider-selection-v9.md), [0264](../../decisions/search/activation/0264-measure-only-unambiguous-provider-shadow-cases-v10.md), [0265](../../decisions/search/activation/0265-test-claim-coverage-before-minimization-v11.md), [0266](../../decisions/search/activation/0266-confirm-claim-coverage-over-four-cases-v12.md), [0267](../../decisions/search/activation/0267-retain-bounded-selection-violation-codes.md), [0268](../../decisions/search/activation/0268-diagnose-and-confirm-claim-coverage-v13.md), [0269](../../decisions/search/activation/0269-test-request-scoped-claim-coverage-v14.md)
- Structured ADRs: [0274](../../decisions/search/activation/provider-shadow-structured/0274-test-relational-coverage-provider-shadow-v17.md), [0276](../../decisions/search/activation/provider-shadow-structured/0276-confirm-relational-coverage-provider-shadow-v18.md), [0277](../../decisions/search/activation/provider-shadow-structured/0277-stage-managed-context-relational-canary.md), [0282](../../decisions/search/activation/provider-shadow-structured/0282-remove-api-key-requirement-from-managed-context-canary.md), [0283](../../decisions/search/activation/provider-shadow-structured/0283-prepare-deterministic-linked-context-canary-v4.md), [0284](../../decisions/search/activation/provider-shadow-structured/0284-prepare-exact-deterministic-native-session-canary-v5.md), [0285](../../decisions/search/activation/provider-shadow-structured/0285-authorize-exact-key-free-managed-canary-v6.md)
- Managed evidence: [v10](provider-shadow/linked-evidence-managed-canary-v10.md), [v11](provider-shadow/linked-evidence-managed-canary-v11.md), [v12](provider-shadow/linked-evidence-managed-canary-v12.md), [v14](provider-shadow/linked-evidence-managed-canary-v14.md), [v18](provider-shadow/linked-evidence-managed-canary-v18.md)
- Managed ADRs: [0290](../../decisions/search/activation/provider-shadow-structured/0290-forward-linked-selections-for-key-free-managed-canary-v11.md), [0291](../../decisions/search/activation/provider-shadow-structured/0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md), [0292](../../decisions/search/activation/provider-shadow-structured/0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md), [0296](../../decisions/search/activation/provider-shadow-structured/typed-context/0296-reject-activation-after-typed-context-managed-canary-v14.md), [0301](../../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md)

# Lexical-v2 activation confirmation v20

Status: `engineering gates passed; eligible for authorized activation review`  
Observed: 2026-08-31

## Conclusion

Frozen lexical-v2 build `sebuild_e9f2ac9398b0f58d03143e7a` passed the preregistered local, provider-free, Codex, and Claude engineering gates without lowering a threshold, deleting a case, retrying an observation, trimming latency, or combining suite revisions.

The result does not claim a production selection. The cases remain `verification_authored` and `pending_human_review`; the source worktree also has no registered operational search corpus or reviewed search cases. ADR-0318 therefore makes the build eligible for authorized review while preserving `lexical-v1` as the implicit operational and rollback engine until a repository completes the existing immutable activation chain.

## Frozen coordinates

- Suite: `lv2bench_provider_comparison.v20`
- Suite digest: `sha256:dea2fda6a941ea83c661d10aa032c10dbd5ad795ee82365204272dc390f8bbe9`
- Corpus digest: `sha256:1651c62c38d9f2c1a337ee35fd502e5fd182a26a30d0ac1df17ac9fefc0d06e1`
- Repository head: `a57125d2d4a7d0f3aa8a9608c70f626fd7ec97c2`
- Working-tree status digest: `sha256:a8901f09dc4d2c34994e8b2b5848c55d11dcf452b554a92c59cd42b42d833eac`
- Repetitions: five per arm and case; 120 observations per provider
- Models: Codex `gpt-5.6-sol`, Claude `opus`; low reasoning effort
- Candidate evidence: at most two query-selected complete Markdown sections/documents under the frozen evidence-delivery contract
- Acceptance: no case regression; recall and precision non-inferiority; at least 45/60 candidate passes and 9/12 cases passing every repetition; at least 85% recall and 50% precision; at most 90% tokens, 95% duration, and 70% injected bytes; complete usage and preparation; native structured output; zero provider, contract, tool, or command failures

Provider-free selection covered every expected path, respected the document bound, and used 27.51% of baseline injected bytes before any provider call.

## Local capability evidence

The final ranker revision retained all original twenty cases and added four public capability cases per language.

| Suite                                        | lexical-v1 | lexical-v2 |        Recall@10 |              MRR | Build p95 ratio | Query p95 ratio |
| -------------------------------------------- | ---------: | ---------: | ---------------: | ---------------: | --------------: | --------------: |
| English, `spreport_2c1a8ef8254e7fe3a1e5102f` |      19/24 |      23/24 | 70.14% -> 90.28% | 40.46% -> 61.37% |          1.766x |          0.944x |
| Korean, `spreport_f94e8e72b6339282c39d17f6`  |      18/24 |      22/24 | 68.75% -> 85.42% | 53.82% -> 64.44% |          1.841x |          0.870x |

Every task type had a candidate-only success and no baseline-only success. Report SHA-256 values are `85a9a6b651dc1e013f154e88ad453c06d369f8cee7b665db61cfbab624f28de6` and `371436c7d180dd8c1cf0825b6a6e5390af3e3b5273f42faee1614dbaf533500d` respectively.

The unchanged legacy twenty-case suites remained 19/20 and 18/20 rather than producing an additional success. They still improved recall, MRR, and warm-query latency. This does not replace the augmented capability suites and is retained as a limit on the claim.

## Cross-provider confirmation

| Measure                        | Codex lexical-v1 | Codex lexical-v2 | Claude lexical-v1 | Claude lexical-v2 |
| ------------------------------ | ---------------: | ---------------: | ----------------: | ----------------: |
| Passed observations            |            37/60 |            60/60 |             40/60 |             60/60 |
| Cases passing every repetition |             7/12 |            12/12 |              8/12 |             12/12 |
| Expected-path recall           |           70.83% |             100% |            70.83% |              100% |
| Returned-path precision        |           65.83% |           97.50% |            66.67% |            90.83% |
| Reported tokens                |        1,489,577 |        1,180,342 |         1,029,489 |           518,565 |
| Total request duration         |        810.166 s |        755.242 s |         721.943 s |         586.183 s |
| Injected evidence bytes        |        1,383,480 |          380,585 |         1,383,480 |           380,585 |

Codex candidate ratios were 79.24% tokens, 93.22% duration, and 27.51% bytes. Claude ratios were 50.37%, 81.20%, and 27.51%. Every candidate observation passed; both providers recorded complete usage and preparation, native structured output, and zero provider, contract, tool, or command failures.

- Codex report SHA-256: `f7303d563979300d7f292c6cd96af5322e2e2650f6f3d8f17931d6001db04eae`
- Claude report SHA-256: `2ab6fb9eeec5d8ac11a8afde1c495d942e9f72c52a3a2194d0c35a88ee348717`

Codex used rolling isolated prewarm. Claude used serialized warm admission after the user's subscription login was restored. These provider-native preparation policies were preregistered, applied symmetrically to both arms within each provider, recorded separately from request duration, and never reused a response, context, thread, or session.

## Retained failures and non-claims

- V18 Codex passed, but V18 Claude failed authentication. They were not combined.
- V19 Claude passed after authentication recovery, but V19 Codex used 97.75% of baseline duration and failed the 95% gate. That report remains failed; its 39.603-second candidate observation was not removed or retried.
- V20 increased repetitions before its first provider call and proportionally raised the observation floor. It retained the untrimmed duration total and every other threshold.
- Provider execution proves measured answer behavior only. It does not prove that an operational repository selected, loaded, injected, or used lexical-v2.
- The corpus is English-dominant. Korean local cases validate deterministic lexical capability, not universal multilingual semantic recall.
- No external engine, credential, network target, corpus export, augmentation plan, or reranker was activated.

## Disposition

- Accept the v20 engineering confirmation and qualify lexical-v2 for authorized activation review.
- Keep the candidate statically registered and replayable with the frozen adapter build identity.
- Keep `lexical-v1` as the no-transition default and explicit rollback target.
- Require a real repository corpus, human-reviewed cases, adoption review, policy, and immutable transition for operational selection.
- Continue external replacement, augmentation, and reranking as distinct observable candidates rather than hiding them inside lexical-v2.

## Related decisions

- [Activation gates](../../../decisions/search/engines/0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Five-repetition preregistration](../../../decisions/search/engines/0317-pre-register-lexical-v2-v20-five-repetition-confirmation.md)
- [Activation-review qualification](../../../decisions/search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Extensible search architecture](../../../research/extensible-search-engine-architecture.md)

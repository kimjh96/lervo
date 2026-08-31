# ADR-0308: Pre-register lexical-v2 pipeline activation gates

Status: `accepted`  
Date: 2026-08-31

## Context

ADR-0307 rejected the first lexical-v2 activation. Its ranker improved aggregate local retrieval, but the original suites showed no candidate-only success in task types already fully passed by lexical-v1. Whole-document injection lacked a deterministic token-saving mechanism, and Claude results were ineligible without a common structured carrier.

Deleting cases, weakening thresholds, adding query-specific aliases, or accepting incomplete provider usage would invalidate the experiment. Provider-free passage-index and query-time MaxP prototypes were rejected for build or query cost and a Korean regression.

## Decision

Freeze lexical-v2 build `sebuild_f80913229c9023d3d74ddc9a` and these independent gates before fresh provider calls:

1. Preserve every original English and Korean case and corpus contract; add four public capability cases to each suite.
2. Require at least one candidate-only success and zero baseline-only successes in every task type, within unchanged local cost bounds.
3. Compare the complete evidence pipeline, not rank scores alone.
4. Keep lexical-v1 at three whole documents. The candidate starts from thirty ranked coordinates, retains three anchors, expands only bounded explicit links and matching canonical specifications, and delivers complete Markdown sections within declared document and byte bounds.
5. Use the same provider-native JSON Schema, model, effort, response protocol, repetitions, and no-tool boundary for both arms.
6. For Codex and Claude independently, require per-case pass-count non-regression, recall and precision non-inferiority, complete usage, zero provider/contract/tool/command failures, no more than 90% of baseline reported tokens, and no more than 95% of baseline duration.
7. Require candidate absolute quality floors, native structured output, and at most 70% of baseline injected bytes.

The ranker, linked expansion, section selector, and carrier receive only the query, ranked canonical sources, and canonical links. They never receive expected paths, case IDs, task types, or provider identity. Public capability queries remain checked in.

The deterministic parser enforces unique source paths. The common native schema omits unsupported transport keyword `uniqueItems` and binds digest `sha256:67232b9de05c38023c5a79cdb6438dbfe3b2965ce4e77294c6d6fca0eae2673e`. A failed pre-model schema attempt is not quality, token, or duration evidence.

## Confirmation revision

Iterations v2-v11 retained every failure and threshold without activation. Their suite digests, coordinate changes, and observed results are in the bounded [evaluation history](../../../evidence/search/lexical-v2/lexical-v2-v2-v11-evaluation-history.md). V11 passed its eight development cases but was ineligible as fresh confirmation because all cases had informed iteration.

Freeze `lv2bench_provider_comparison.v12`, digest `sha256:01ab1ee72a8022b7ddee5c80d651c8ae2e5e673ccf08ab913aa7c29b56ad3f08`. It preserves the original eight provider cases and adds one previously uncalled case for each task type. Three repetitions of two arms schedule 72 invocations per provider. Scaled floors require at least 27/36 candidate passes and nine of twelve cases passing every repetition. The 85% recall, 50% precision, 90% token, 95% duration, zero-failure, structured-output, isolation, and byte gates remain unchanged.

The holdouts exposed two provider-free defects before a model call. A Korean rationale query retained natural wording plus public English search terms rather than adding a translation alias. The selector generalized mixed ASCII-identifier and Korean-particle splitting, and canonical expansion required at least three query terms in both the complete document and delivered sections. Neither correction received expected paths.

Provider-free v12 covered every expected path, observed the four-document bound, and injected 37.65% of baseline bytes. Freeze these source digests:

- ranker: `sha256:395bbc7a9622f034bfa50b480dedfc0d2c20745dcda1dbe520141bcab1a0d017`
- section selector: `sha256:0ac621849f7c8e2e2f930bbdadbf1f003e6028e32c37598c3a5b9e85248b1c57`
- evidence pipeline: `sha256:3d0de02514005a3f3a1c3f4f87bfb81633d05968c12bbcd3b8ebf7ce9dbede92`
- runner: `sha256:490252fdb20329acb704243eb63df588a2fa91e9eddd771e6d3391f3046bd126`
- comparison contract: `sha256:8d5decd7460663fbe33b19e4a4145eb257498109757ffbeb69647baf7ba6b5cb`

No implementation, protocol, query, expected path, or threshold may change after a v12 provider call. Any failure rejects activation.

## V12 result

Both confirmations completed all 72 scheduled invocations without retries. Codex failed case-level non-regression on the new knowledge-lifecycle status holdout and reduced duration by 2.98%, below the required 5%. Claude reduced tokens by 40.99% and duration by 6.77%, but native structured-output activity appeared as one completed tool call on every arm; symmetric zero-tool and provider-contract gates rejected all observations. No frozen coordinate changed.

[ADR-0309](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md) records the terminal disposition: retain operational lexical-v1 and keep lexical-v2 evaluation-only.

## Consequences

The evidence pipeline is engine-agnostic. A future local or external retriever can supply ranked coordinates without changing linked expansion, section delivery, carrier validation, or provider acceptance. External-only replacement and composed retrieval still require ADR-0306 stage, privacy, index-receipt, and failure contracts. This decision authorizes no credentials, corpus export, arbitrary dynamic code loading, production target, or activation.

## Verification

- Shared lexical-v2 adapter and identifier-component differential tests.
- Original-plus-challenge English and Korean performance reports.
- Deterministic section-selector, bounded-expansion, and provider-contract tests.
- Provider-free expected-path, document, and injected-byte gates.
- Fresh matched Codex and Claude reports with independent decisions.
- Repository quality, build, documentation, knowledge, release-completion, and common provider-adapter checks.

## References

- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [First lexical-v2 disposition](0307-revise-lexical-v2-after-local-and-provider-evaluation.md)
- [Final v12 disposition](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [Extensible search architecture](../../../research/extensible-search-engine-architecture.md)
- [OpenAI model reasoning-effort guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Claude effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort)

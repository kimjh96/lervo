# Lexical-only versus linked-context uplift report

Status: `complete_no_quality_uplift`
Date: 2026-08-30

The deterministic linked-context default did not improve this paired population over `lexical-v1`. Across 32 fresh native-session runs, both arms retained 100% expected-source recall. Linked context reduced mean claim recall by 9.38 percentage points for Codex and 3.13 points for Claude. It reduced mean duration by about 10% for both providers and Codex-reported total tokens by 7.02%, but increased Claude-reported total tokens by 28.33%.

Among 16 exact task pairs, linked context won two quality comparisons, tied nine, and lost five. The results support no general accuracy, speed-and-accuracy, or token-saving claim for the active default. This report did not change production state. [ADR-0302](../../../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) subsequently retired the ordinary linked default and selected the existing search-engine ports as the future extension boundary.

## Operational readiness finding

The source worktree had zero registered search documents before the experiment, including after repository-knowledge refresh. Its default linked projection was therefore empty and effectively identical to lexical-only.

The provider experiment used a clean isolated workspace containing 347 registered documents copied from the current source snapshot. It measures the implemented linked mechanism when its registration prerequisite is present, but does not prove that ordinary repositories satisfy that prerequisite.

## Bound population

- Contract: `benchmarks/search/lexical-linked-uplift-v1.json`
- Contract digest: `sha256:b424f70a5f3440ffa31aa664e65b1288a4f1b3b69f0f3abaf6cff22ee50f004d`
- Observation-set digest: `sha256:8fa291dcc7c65145ae96aeba26c96c6d2cb90d039aa7f14e124b0cae10e0dd7b`
- Built CLI digest: `sha256:d6e888f98c39103fad298ab1177cd6b07cdeef668ee6ea045df493a6ddc58ba8`
- Source repository status digest: `sha256:5a5f5085de5e96caa31f7f99b501c0164c14cdadcef969ac07889a66aa6dce88`
- Population: four cases, two repetitions, two providers, and two arms
- Codex: `gpt-5.6-sol`, eight lexical-only and eight linked runs
- Claude: `opus`, eight lexical-only and eight linked runs
- Transport: native signed-in sessions; no user API key
- Execution: read-only, one task call per run, zero selection-model calls, and zero retries
- Ordering: alternating provider and arm order within paired source tasks
- Accepted technical failures: zero

The only arm difference was the dependency-scoped result of the current default linked-evidence resolver. The control returned no default linked selections; the treatment used the unmodified production resolver. Search engine, corpus, query, model, role, verification, adapter configuration, and scoring were otherwise fixed.

## Provider results

| Provider and arm | Runs | Source recall | Claim recall | Complete answers | Mean duration | Mean total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex lexical-only | 8 | 100% | 87.50% | 62.50% | 175.353 s | 1,065,163 |
| Codex + linked | 8 | 100% | 78.13% | 50.00% | 157.660 s | 990,407 |
| Claude lexical-only | 8 | 100% | 90.63% | 62.50% | 105.049 s | 157,030 |
| Claude + linked | 8 | 100% | 87.50% | 62.50% | 95.013 s | 201,520 |

| Provider | Claim-recall change | Complete-rate change | Duration change | Mean token change per task | Total-token change | Quality win / tie / loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | -9.38 pp | -12.50 pp | -10.09% | -74,756 | -7.02% | 1 / 4 / 3 |
| Claude | -3.13 pp | 0 pp | -9.55% | +44,490 | +28.33% | 1 / 5 / 2 |
| Equal-provider combined | -6.25 pp | -6.25 pp | -9.89% | -15,133 | -2.48% | 2 / 9 / 5 |

The equal-provider token average is too unstable to establish savings. Codex's much larger usage values dominate the combined arithmetic mean, while the median paired task used 28,691 more reported tokens with linked context. Provider token accounting is descriptive, differs by adapter, and is not billing evidence.

## Added-context cost

Treatment runs selected an average of 31,395 linked-source bytes, approximately 7,849 tokens at four bytes per token. Case-level selections ranged from two to eight documents and 8,190 to 53,497 bytes. Actual provider-reported token deltas were much larger and changed sign because context affected later exploration and reasoning, not only initial prompt size.

Treatment was faster on mean for both providers but did not preserve quality. One Codex historical-rationale pair fell from 75% to 25% claim recall while saving 1,102,979 reported tokens. Another Codex repetition rose from 50% to 75% while consuming 1,376,481 more tokens. Claude recorded one quality win and two losses. These reversals reject an unconditional performance or economy claim.

## Scoring and limitations

Expected-source recall credits a canonical path named in raw provider output or referenced through current E4 evidence. Claim recall uses case-specific, predeclared observable phrases derived from canonical sources. Linked-only sources remain ineligible for E4 references, so E4 is supporting evidence rather than the incremental quality measure.

The deterministic lexical scorer can miss semantically correct paraphrases. The population is small and repository-specific: four cases with two repetitions. Model output is stochastic, the corpus is English-dominant, queries are Korean-framed, and isolated registration does not establish readiness in current user repositories. These limits do not erase observed quality losses but prevent broader positive or negative generalization.

## Disposition

- Do not claim that the active linked default improves accuracy over lexical-only.
- Do not claim cross-provider token savings.
- Treat the roughly 10% mean duration reduction as an observation with quality regressions, not an optimization win.
- The ordinary linked default is retired; do not add another post-search context exception as its replacement.
- Evaluate `lexical-v2` or an external engine through the existing engine port, paired comparison, reviewed activation, and rollback contracts.
- Separately resolve the zero-document operational registration gap; an empty projection provides neither benefit nor measured harm.

## References

- [Managed canary v18](../provider-shadow/linked-evidence-managed-canary-v18.md)
- [Activation decision](../../../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md)
- [Retirement and engine-extension decision](../../../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
- [Natural-language quality roadmap](../../../roadmap/natural-language-grounding-quality.md)

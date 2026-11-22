# Korean-framed repository retrieval observation v1

Status: `observed`
Observation date: 2026-08-27

## Scope

This observation compares operational `lexical-v1` with inactive candidate `local-hybrid-v1` across 20 Korean-framed repository requests and 20 one-to-one English controls. Each pair shares task type, expected paths, top-10 rank, and corpus. All cases are `verification_authored` and await human review.

This is historical evidence. ADR-0226 later retired the candidate and removed the dedicated `lervo search benchmark` command; the commands below record the original procedure, not a current CLI surface.

The corpus excludes this evidence directory, generated knowledge, ADR-0224, and its roadmap to prevent self-influence. Both reports bind corpus digest `sha256:04d7c7df0b257f3ca274a3825699d7c489658303143d669df850f027cba841f5`: 263 documents and 961,704 bytes.

Only two included Markdown documents contain Hangul. The suite measures the ranking of English repository anchors within Korean framing, not general Korean-to-English semantic retrieval.

## Protocol

Expected paths and pairings were checked before candidate execution:

```sh
pnpm evaluation:natural-language:check
lervo search benchmark --suite benchmarks/search/korean-repository-retrieval-v1.json
lervo search benchmark --suite benchmarks/search/korean-repository-retrieval-control-v1.json
```

Each benchmark used five paired build warmups, 30 recorded build pairs, five warm-query passes, and 30 query repetitions. The existing top-50 response was evaluated at rank 10. Suites ran sequentially to prevent concurrent benchmark interference.

## Korean-framed result

Fresh report `spreport_26459fd63fcc0715869860bd` binds suite hash `sha256:f657d6ed400d9e4503358b84ee4056bd702e62f3cb9034ae0f5fe018a4dd29b9`.

| Metric         |   `lexical-v1` | `local-hybrid-v1` |   Difference or ratio |
| -------------- | -------------: | ----------------: | --------------------: |
| Success@10     | 19/20 (95.00%) |    19/20 (95.00%) | 0 cases / 0.00 points |
| Mean Recall@10 |         90.00% |            90.00% |           0.00 points |
| MRR            |         72.50% |            80.00% |          +7.50 points |
| Build p95      |      22.138 ms |         59.281 ms |         2.678x slower |
| Warm-query p95 |       2.338 ms |          2.622 ms |         1.122x slower |

The candidate improved first relevant rank in four cases and regressed in none. Both engines failed the same user-owned managed-block boundary case. The candidate added no successes or recall gains, and all four task-type coverage gates failed. Observed cost passed; quality failed.

## English-control result

Fresh report `spreport_653c0ebdc73991267597ffbb` binds suite hash `sha256:9ca1bd8694696de1ca934bd0f6a7888fd4ddb4818a969e72366f60e91d74ce86`.

| Metric         |   `lexical-v1` | `local-hybrid-v1` |    Difference or ratio |
| -------------- | -------------: | ----------------: | ---------------------: |
| Success@10     | 17/20 (85.00%) |    18/20 (90.00%) | +1 case / +5.00 points |
| Mean Recall@10 |         82.50% |            87.50% |           +5.00 points |
| MRR            |         39.40% |            60.55% |          +21.15 points |
| Build p95      |      22.555 ms |         63.831 ms |          2.830x slower |
| Warm-query p95 |       4.088 ms |          4.477 ms |                 1.095x |

The candidate recovered the agent-workspace status case, improved first relevant rank in 12 other cases, and regressed the selected-skill evidence-boundary case from rank 5 to rank 10. Only the status, continuation, and impact coverage gate passed; the other three failed. Aggregate quality failed because the candidate added one rather than two successes and improved Success@10 by 5 rather than 10 percentage points. Observed cost passed.

## Paired interpretation

Korean-framed queries outscored English controls for both engines, but this does not demonstrate Korean understanding. Most Korean tokens have no corpus match, while common English framing can elevate competing documents; more matched natural-language framing can therefore weaken a precise repository anchor.

Engine retrieval and conversational grounding are separate. This comparison does not test a Korean request such as “let's do the OO task” without an English anchor, prior-turn resolution, workstream continuation, approval authority, abstention, or answer correctness; those belong to the grounding suite.

## Korean-only historical-rationale diagnosis

Three public discovery probes removed every English repository anchor and targeted `docs/decisions/knowledge/repository/0199-structured-workstream-continuation-state.md`. Operational `lexical-v1` returned no hits for all three. A bounded replay through the inactive candidate used the same corpus and adapter build `sebuild_d6030922734befd7cc0ac85b`:

| Probe                                                         | `lexical-v1` target rank | `local-hybrid-v1` target rank |
| ------------------------------------------------------------- | -----------------------: | ----------------------------: |
| Why the prior work state continues into the next conversation |                     None |                            15 |
| Why current state is stored separately for continuation       |                     None |                Outside top 50 |
| Why prior work can continue in a new conversation             |                     None |                Outside top 50 |

The target ADR contains no Hangul. The candidate hashes words, adjacent pairs, and character trigrams but has no translation-equivalence input. Fusion-weight tuning cannot recover the two targets absent from both top-50 branches, while promoting collision-derived similarity would weaken determinism without establishing semantics.

## Disposition

Keep operational search at `lexical-v1`. ADR-0225 marks `local-hybrid-v1` for revision while preserving it as an inactive reproducible candidate because:

- cases are verification-authored, not reviewed production failures;
- neither suite passed every task-type coverage gate;
- English controls contain a candidate ranking regression;
- both suites failed the aggregate adoption threshold; and
- observed cost compliance does not authorize activation.

The provider-neutral deterministic grounding runner is implemented and separately observed. A complete agent pre-review partitions all 52 exact cases and records four lexical failure candidates plus one rank regression. Three additional historical-rationale probes reproduce the cross-language limitation but remain verification-authored rather than production evidence. Human review still gates provenance promotion and activation; it neither blocks the conservative decision to keep the candidate inactive nor requires approval of every fixture during normal engineering work.

See [ADR-0224](../../decisions/search/0224-natural-language-grounding-quality-evaluation.md), [ADR-0225](../../decisions/search/0225-revise-local-hybrid-for-cross-language-recall.md), the [provider-neutral grounding runner observation](provider-neutral-grounding-runner-v1.md), the [natural-language case pre-review](natural-language-case-pre-review-v1.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

## Later disposition

ADR-0226 supersedes the revise disposition after a same-model delegated-retrieval pilot recovered all three Korean-only no-hit probes through direct read-only repository exploration. The decision retires `local-hybrid-v1` and evaluates a bounded lexical-first model fallback; it neither reinterprets these measurements nor authorizes production fallback behavior.

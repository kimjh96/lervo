# Repository retrieval performance observation v1

Status: `observed`
Observation date: 2026-08-25

## Scope

This repository regression observation compares the deterministic `lexical-v1` baseline with the inactive `local-hybrid-v1` candidate using the public suite at `benchmarks/search/repository-retrieval-v1.json`. It is not a human-reviewed production-query sample.

The corpus contains the repository README, AGENTS instructions, and canonical Markdown documentation. It excludes this search-evidence directory to prevent self-influence and the rebuildable `docs/knowledge` projection to avoid duplicate sources and lifecycle-driven invalidation.

The suite contains 20 verification-authored `maximumRank=10` cases: five each for exact repository terminology, wording or morphology variation, multiple expected sources, and ambiguous near-neighbors.

## Protocol

Run from the repository root:

```sh
lervo search benchmark --suite benchmarks/search/repository-retrieval-v1.json
```

Corpus loading is excluded. The runner performs five paired build warmups and 30 recorded build pairs, alternating engine order. It builds query indexes once, performs five warm-query passes, and records 30 repetitions per query while alternating engine order and rotating case order. Searches use the existing top-50 response; quality is assessed at rank 10.

## Result

Report `spreport_9a7ae6993a39e598d25948c9`, produced by benchmark build `spbuild_6b596abcfa8eabf2ab9e27d5`, measured suite hash `sha256:05cbbcfd93c54c2d568a3662ef6e63d15a6eb2781aca69271925792b009f3ac0` against corpus digest `sha256:e36dc87579794358019c3151c9df07e829098c90d065ca768c2667e6d3f6f1d7`: 246 documents and 811,165 bytes.

| Metric | `lexical-v1` | `local-hybrid-v1` | Difference or ratio |
| --- | ---: | ---: | ---: |
| Success@10 | 20/20 (100.00%) | 20/20 (100.00%) | 0 cases / 0.00 points |
| Mean Recall@10 | 93.33% | 97.50% | +4.17 points |
| MRR | 77.50% | 85.42% | +7.92 points |
| Build p50 | 17.585 ms | 131.398 ms | 7.47x slower |
| Build p95 | 19.996 ms | 152.199 ms | 7.61x slower |
| Warm-query p50 | 1.813 ms | 2.295 ms | 1.27x slower |
| Warm-query p95 | 2.406 ms | 2.936 ms | 1.22x slower |

The candidate improved first relevant rank in six cases, regressed in two, and tied in 12. Multiple-expected-source cases produced three candidate wins, no baseline wins, and the Recall@10 gain. All exact-terminology cases tied. Ambiguous-neighbor cases split one win each. Wording or morphology cases produced two candidate wins and one baseline win. Success@10 was saturated for both engines.

The aggregate coverage threshold failed: there were no additional successful cases, Success@10 did not increase, and Recall@10 improved by 4.17 rather than the required 5 points. All four coverage-win task gates failed. The separate ranking observation was `aggregate_gain_with_case_regressions`. Warm-query p95 met the 1.5x cost bound, but build p95 exceeded the 3x bound, so the combined observed-cost gate failed. Adoption remains undetermined.

The run used macOS 25.5.0 on arm64, an Apple M5 with 10 logical processors and 24 GiB total memory, and Node v26.5.1 without runtime flags. The baseline adapter build was `sebuild_073b0780d99e88826883758a`; the candidate build was `sebuild_58babf63434c6e3606fd860b`.

## Interpretation

The observation reports Success@10, Recall@10, MRR, individual and task-type rank comparisons, build p50/p95, and warm-query p50/p95. Aggregate quality and timing thresholds are advisory. The report fixes `adoptionDecision=not_determined`; operational activation still requires reviewed lexical failures, dedicated reviewed bundles, no-regression comparison, replay, policy, and human review.

The timing environment records OS, architecture, processor, logical CPU count, memory observations, Node version, runtime flags, and a hostname digest. Power mode and competing workloads are unobserved. One local run cannot establish production throughput, concurrency behavior, tail latency under load, energy cost, or performance on another machine.

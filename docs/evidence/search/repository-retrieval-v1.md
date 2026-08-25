# Repository retrieval performance observation v1

Status: `observed`
Observation date: 2026-08-25

## Scope

This repository regression observation compares the deterministic `lexical-v1` baseline with the inactive `local-hybrid-v1` candidate using the public suite at `benchmarks/search/repository-retrieval-v1.json`. It is not a human-reviewed production-query sample.

The corpus contains the repository README, AGENTS instructions, and canonical Markdown documentation. It excludes this search-evidence directory to prevent self-influence and the rebuildable `docs/knowledge` projection to avoid duplicate sources and lifecycle-driven invalidation.

The suite has 20 verification-authored `maximumRank=10` cases: five each for exact repository terminology, wording or morphology variation, multiple expected sources, and ambiguous near-neighbors.

## Protocol

Run from the repository root:

```sh
lervo search benchmark --suite benchmarks/search/repository-retrieval-v1.json
```

Corpus loading is excluded. The runner performs five paired build warmups and 30 recorded build pairs with alternating engine order. It builds query indexes once, performs five warm-query passes, and records 30 repetitions per query while alternating engine order and rotating case order. Searches use the existing top-50 response; quality is assessed at rank 10.

## Result

Report `spreport_32812bd3c17cd2b86b741b6b`, produced by benchmark build `spbuild_6b596abcfa8eabf2ab9e27d5`, measured suite hash `sha256:05cbbcfd93c54c2d568a3662ef6e63d15a6eb2781aca69271925792b009f3ac0` against corpus digest `sha256:b9b9327d3573d7e6ebb28b9066b53617804273e1714dcb195a516d460c99b315`: 246 documents and 813,466 bytes.

| Metric | `lexical-v1` | `local-hybrid-v1` | Difference or ratio |
| --- | ---: | ---: | ---: |
| Success@10 | 20/20 (100.00%) | 20/20 (100.00%) | 0 cases / 0.00 points |
| Mean Recall@10 | 93.33% | 97.50% | +4.17 points |
| MRR | 77.50% | 85.42% | +7.92 points |
| Build p50 | 17.293 ms | 49.031 ms | 2.84x slower |
| Build p95 | 19.897 ms | 56.164 ms | 2.82x slower |
| Warm-query p50 | 1.766 ms | 1.994 ms | 1.13x slower |
| Warm-query p95 | 2.367 ms | 2.589 ms | 1.094x |

The candidate improved first relevant rank in six cases, regressed in two, and tied in 12. Multiple-expected-source cases had three candidate wins, no baseline wins, and the Recall@10 gain. All exact-terminology cases tied. Ambiguous-neighbor cases split one win each. Wording or morphology cases had two candidate wins and one baseline win. Success@10 was saturated for both engines.

The aggregate coverage threshold failed: there were no additional successful cases, Success@10 did not increase, and Recall@10 improved by 4.17 rather than the required 5 points. All four coverage-win task gates failed. The separate ranking observation was `aggregate_gain_with_case_regressions`. Warm-query p95 met the enforced 1.5x bound and preferred 1.1x objective. Build p95 met the 3x bound, so the combined observed-cost gate passed. Cost acceptance does not satisfy the quality or activation gates; adoption remains undetermined.

The preceding recorded implementation used report `spreport_9a7ae6993a39e598d25948c9` and candidate build `sebuild_58babf63434c6e3606fd860b`. Its candidate build p95 was 152.199 ms and warm-query p95 was 2.936 ms. The optimized candidate reduced those observed latencies by approximately 63% and 12%, respectively. The current corpus is 2,301 bytes larger because the canonical decision and roadmap now document the optimization, making this historical comparison observational rather than a byte-identical A/B run. Exact differential tests separately establish response equivalence for the representation change.

The run used macOS 25.5.0 on arm64, an Apple M5 with 10 logical processors and 24 GiB total memory, and Node v26.5.1 without runtime flags. The baseline adapter build was `sebuild_073b0780d99e88826883758a`; the candidate build was `sebuild_d6030922734befd7cc0ac85b`.

## Interpretation

The observation reports Success@10, Recall@10, MRR, individual and task-type rank comparisons, build p50/p95, and warm-query p50/p95. Aggregate quality and timing thresholds are advisory. The report fixes `adoptionDecision=not_determined`; operational activation still requires reviewed lexical failures, dedicated reviewed bundles, no-regression comparison, replay, policy, and human review.

The timing environment records OS, architecture, processor, logical CPU count, memory observations, Node version, runtime flags, and a hostname digest. Power mode and competing workloads are unobserved. One local run cannot establish production throughput, concurrency behavior, tail latency under load, energy cost, or performance on another machine.

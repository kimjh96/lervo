# Catalog-assisted repository retrieval v3

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can a deterministic repository path-title catalog expose incomplete lexical bundles and stabilize no-hit exploration while preserving direct-model retrieval quality and v2's resource savings?

## Pre-registered decision contract

The checked-in suite required catalog-assisted v3 to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to contemporaneous model direct in pass count and exact expected-path recall;
- use no more than 85% of model-direct observed total tokens and 95% of model-direct wall duration;
- have no worse no-hit p95 duration or latency standard deviation than model direct;
- produce no provider-contract or catalog-contract failures; and
- drop no relevant lexical recommendation or relevant named catalog candidate.

Any failed criterion rejected v3. The grounded-answer verdict covers exact expected paths, abstention, preservation, and observable catalog behavior. It is not semantic answer judgment or proof of provider understanding. Token usage is a provider observation, not billed cost.

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight verification-authored cases and their exact expected paths were unchanged from v2 except for the case-ID prefix. Model direct and v3 each ran three times per case in independent sessions, producing 48 accepted provider turns with rotating arm order.

V3 received the top three `lexical-v1` documents and a deterministic catalog of all 282 sanitized corpus paths and first headings. The 37,778-byte catalog contained no source bodies. The provider had to either declare the anchors complete without inspection or name up to four catalog candidates outside the anchors and inspect them. A no-hit required at least one named candidate and inspection.

The English-dominant corpus excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated search decisions. The accepted run binds:

- suite digest: `sha256:97d80ec3d2573deb610a00bb9941d3710618db1d4607a86807b5c3a813b9177d`;
- protocol digest: `sha256:07aaeda1e93252f2fb2194aa2ebce3910900da3e39a5a83d762811dd7099cff5`;
- catalog digest: `sha256:2b08361a8f72429b742f336a20a6ab4cf0aa710cbc26c91f245fbd4b767d1e22`;
- corpus digest: `sha256:02e6554389f2941b9a95aee4c4ec20c73eae7b6f4562719e88ea11d5536c361a`;
- repository revision: `46b36f1a192c3f6e19baa4da5d803900a2a84279`;
- working-tree status digest: `sha256:2b1a6bc26616b214dba2ee0c808e72e3e31b877b088635bc3c53f62b7b311c27`; and
- raw operator-only report digest: `sha256:81529581a687e9356037b591d317131b4d8a68833f8ff9faeb6a9e1f2da58da2`.

The raw report and answer text were moved to recoverable system Trash after this redacted observation was produced. This document contains no source bodies, absolute paths, or answer prose.

The raw report's policy metadata omitted `relevant_catalog_candidate_dropped`, although the pre-registered acceptance object, per-run counters, summary, and decision tracked that failure with a zero threshold. The checked-in runner's reporting-only enumeration was corrected after the run. No prompt, observation, score, threshold, aggregate, or verdict changed; the provider turns were neither rerun nor reinterpreted.

## Result

V3 failed four of eleven pre-registered criteria: repeatability, pass-count non-inferiority, recall non-inferiority, and the catalog contract. Both resource criteria, both no-hit latency criteria, both preservation criteria, and the provider contract passed.

| Metric | Model direct | Catalog assisted v3 |
| --- | ---: | ---: |
| Grounded-answer verdicts passing | 15/24 | 11/24 |
| Cases passing all three repetitions | 4/8 | 3/8 |
| Mean expected-path recall | 77.08% | 75.00% |
| Mean returned-path precision | 30.56% | 52.37% |
| Wall duration | 1,292.060 s | 784.863 s |
| Mean duration | 53.836 s | 32.703 s |
| Duration p50 | 43.057 s | 25.212 s |
| Duration p95 | 97.792 s | 78.240 s |
| No-hit duration p50 | 38.169 s | 23.819 s |
| No-hit duration p95 | 46.009 s | 36.335 s |
| No-hit latency standard deviation | 5.179 s | 4.774 s |
| Completed repository commands | 87 | 23 |
| Observed total tokens | 3,640,831 | 1,695,499 |
| Provider-contract failures | 0 | 0 |
| Catalog-contract failures | N/A | 1 |
| Dropped relevant recommendations | N/A | 0 |
| Dropped relevant catalog candidates | N/A | 0 |

Relative to model direct, v3 used 53.43% fewer tokens, took 39.25% less wall time, issued 73.56% fewer repository commands, reduced p50 by 41.44%, reduced p95 by 19.99%, and improved precision by 21.81 percentage points. It improved no-hit p95 by 21.03% and no-hit standard deviation by 7.82%.

V3 also produced four fewer passing observations, one fewer fully repeatable case, and 2.08 percentage points lower recall. Those losses and one catalog-contract failure prevent activation despite the resource and no-hit improvements.

## Comparison with v2

Historical v2 used 34.71% of its direct baseline's tokens and 54.26% of its duration; v3 used 46.57% and 60.75%. V3's ratios were 11.86 and 6.49 percentage points worse, respectively. Its direct-relative recall gap narrowed from 18.75 to 2.08 percentage points, its pass deficit narrowed from five to four observations, and recommendation drops fell from one to zero.

V2's no-hit p95 and standard-deviation ratios were 116.06% and 191.21% of direct. V3 reduced them to 78.97% and 92.18%, improvements of 37.09 and 99.03 ratio percentage points. Absolute v3-versus-v2 totals are descriptive only because the repository snapshot, corpus, comparison arms, and direct observations changed.

## Failure diagnosis

- Ordinary release lookup passed 3/3 in both arms. V3 named and read the missing version-management source every time.
- Historical hybrid-search rationale passed 3/3 in both arms. V3 correctly treated the exact lexical anchor as complete and issued no repository command.
- Node-fleet impact missed `docs/architecture/system.md` in all three v3 repetitions. Every response declared the anchors complete and performed no inspection.
- Fuzzy-merge boundaries missed the cross-provider exact-merge decision in all three v3 repetitions. Two responses declared the anchors complete; one inspected two unrelated knowledge sources.
- User-owned-block boundaries missed `docs/specifications/execution.md` in every arm and repetition. V3 always declared the anchors complete, confirming the earlier suite-wide discovery weakness.
- The terse release action returned both exact paths in all three v3 repetitions but abstained under the read-only benchmark, so all three deterministic verdicts failed. Model direct abstained twice. This is a stable action-versus-retrieval fixture limitation, not evidence that the expected sources were absent.
- For the first no-hit phrasing, v3 found the exact source in every repetition, but one response named catalog candidates without observable inspection, causing the only catalog-contract failure. For the second phrasing, v3 passed 3/3 versus direct 2/3.

The catalog repaired candidate discovery and no-hit latency but did not make the provider reliably question a plausible incomplete anchor bundle. Provider-authored completeness remains the failing dependency.

## Decision

Reject catalog-assisted v3 and do not activate it in managed execution. Keep `lexical-v1` operational. The v3 runner, suite, and redacted observation remain a reproducible negative baseline.

Any later candidate must replace provider self-assessment with deterministic, query-independent machine-side coverage or wait for human-reviewed ground truth. It must not reintroduce question-category routing, relax thresholds, treat confidence as completeness, or silently activate managed provider calls.

See [ADR-0240](../../decisions/search/0240-evaluate-catalog-assisted-retrieval-v3.md), the [v2 observation](lexical-assisted-v2.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).

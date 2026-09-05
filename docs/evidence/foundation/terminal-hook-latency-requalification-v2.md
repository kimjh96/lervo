# Terminal hook latency requalification v2

Status: `passed`

Observed: 2026-09-05

## Conclusion

The current Codex direct-terminal hook build passed unchanged latency budgets across 30 complete fixed-request Prompt/Stop pairs. Prompt p95 was 13,937.214 ms against 15,000 ms; Stop p95 was 1,942.938 ms against 5,000 ms. Maxima were 14,851.579 ms and 2,249.657 ms, both below the 30-second ceiling.

The immediately preceding build failed a fresh latest-30 diagnostic: Prompt p95 was 16,072.312 ms, query projection p95 was 13,622.889 ms, and approximately 1.9 seconds of corpus preparation preceded projection. That failed population remains stored under its own environment-profile digest. Remediation moved concurrent input preparation into a dedicated module without changing provider, evidence, privacy, selection, lifecycle, or availability-safe failure meanings.

## Cohort protocol

- Provider: `codex`
- Hook contract: `lervo_terminal_hooks_v2`
- Current environment profile: `sha256:c591ef1278d0b1ab741b62bd6fbff2d241ac9e671737a0a571bac1f5af5416d4`
- Repository profile: `custom`
- Cold state: `unknown`; no warm or cold cache state is inferred
- Population: 30 sequential fixed-request Prompt/Stop pairs
- Acceptance window: latest 30 reports, with zero missing hook observations, incomplete outcomes, or invalid stage sets
- Retry policy: no invocation was retried, removed, or replaced; all 30 pairs completed
- Percentiles: nearest-rank projection owned by `lervo terminal budget`

Fixed request: “Measure the current terminal hook latency requalification boundary.” The first Prompt was a bounded post-build probe; its matching Stop and the remaining 29 pairs used the same runtime, request, and coordinate protocol. Evidence covers only this operational repository, provider, machine, and build.

## Implementation boundary

`terminal-prompt-preparation` owns three concurrent read-only branches: corpus and instruction preparation, query projection prerequisites plus provider projection, and repository snapshot capture. Query projection depends only on the verified current workstream and repository publication language. After all branches settle, the coordinator rejects results if the project ID or publication language differs from the complete corpus scan.

`terminal-prompt-context` owns attention, selection, exact loading, bounded context assembly, and the returned evidence structure. A focused concurrency test holds the corpus branch open and proves query and snapshot branches start before its release. A second test proves coordinate disagreement fails closed. Existing terminal integration tests cover lifecycle, retrieval, workstream, privacy, and availability-safe behavior.

## Hook latency budget

| Hook | Samples | p50 | p95 | Maximum | p95 budget | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `UserPromptSubmit` | 30 | 10,482.491 ms | 13,937.214 ms | 14,851.579 ms | 15,000 ms | Below |
| `Stop` | 30 | 1,821.690 ms | 1,942.938 ms | 2,249.657 ms | 5,000 ms | Below |

`lervo terminal budget --provider codex --limit 30 --minimum-samples 30 --json` returned exit 0, `passed`, and no reason codes. Prompt p95 was 2,135.098 ms lower than the preceding build's failed 16,072.312 ms. This comparison is diagnostic, not a controlled causal estimate.

## Stage timing

| Hook | Stage | Samples | p50 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: |
| Prompt | `ingress_integrity` | 30 | 0.981 ms | 1.059 ms | 1.070 ms |
| Prompt | `repository_discovery` | 30 | 0.089 ms | 0.097 ms | 0.105 ms |
| Prompt | `lifecycle_inspection` | 30 | 23.143 ms | 24.225 ms | 24.311 ms |
| Prompt | `corpus_preparation` | 30 | 2,065.583 ms | 2,266.230 ms | 2,302.793 ms |
| Prompt | `repository_snapshot` | 30 | 2,536.029 ms | 2,951.931 ms | 3,070.414 ms |
| Prompt | `query_projection` | 30 | 9,936.295 ms | 13,366.897 ms | 14,277.981 ms |
| Prompt | `search` | 30 | 418.779 ms | 432.053 ms | 440.227 ms |
| Prompt | `exact_loading` | 30 | 0.557 ms | 0.744 ms | 0.746 ms |
| Prompt | `context_assembly` | 30 | 0.914 ms | 1.090 ms | 1.093 ms |
| Prompt | `event_commit` | 30 | 12.936 ms | 14.992 ms | 15.031 ms |
| Stop | `ingress_integrity` | 30 | 0.975 ms | 1.085 ms | 1.394 ms |
| Stop | `repository_discovery` | 30 | 0.089 ms | 0.095 ms | 0.115 ms |
| Stop | `lifecycle_inspection` | 30 | 1,694.566 ms | 1,810.385 ms | 2,121.919 ms |
| Stop | `event_commit` | 30 | 125.162 ms | 133.982 ms | 134.437 ms |

Sibling stage durations overlap and must not be summed into total duration. Query projection dominates Prompt; exact lifecycle inspection dominates Stop.

## Token, cache, and cost boundary

Query-projection usage was present for every Prompt observation:

| Counter | Samples | Minimum | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Input tokens | 30 | 11,700 | 11,704 | 11,706 | 11,706 |
| Cached input tokens | 30 | 0 | 7,680 | 7,680 | 7,680 |
| Output tokens | 30 | 82 | 150 | 191 | 195 |
| Reasoning output tokens | 30 | 0 | 61 | 95 | 104 |
| Total tokens | 30 | 11,786 | 11,852 | 11,893 | 11,897 |
| Context window | 30 | 258,400 | 258,400 | 258,400 | 258,400 |

Counters cover only `query_projection`. Cached input overlaps input; reasoning output may overlap output. Direct whole-task usage remains unsupported with `unmanaged_provider_usage_unobserved`: the hook payload exposes no attributable usage for the main provider turn, tools, or complete user request. Monetary cost remains unobservable because no billing descriptor, price coordinate, currency, tax, discount, or invoice reconciliation is present.

## Fail-closed evidence

- With `--max-query-tokens 11898`, every projection stayed below the ceiling; the command returned exit 0 and `passed`.
- With `--max-query-tokens 11897`, the observation exactly at 11,897 tokens became exhausted; the command returned exit 1 and `blocked`. The configured ceiling is inclusive.
- With `--limit 100`, the command returned exit 1 and `blocked`. The preceding build retained Prompt p95 of 16,072.312 ms and Stop p95 of 8,085.579 ms, both exhausted. The current passing build did not overwrite or dilute that population.

The 11,897 and 11,898 values are cohort-derived probes, not an adopted production token budget. Missing or insufficient observations require escalation by default; an exhausted configured limit blocks by default.

## Claim limits

The cohort proves only Lervo-owned hook elapsed time and query-projection usage. It does not prove provider acceptance of prepared context, semantic use, main-turn duration or tokens, billing cost, behavior on another provider or host, or future-build performance. The provider-free paired benchmark remains a separate regression protocol.

## References

- [Execution stage observation and performance](../../specifications/execution/stage-observation-and-performance.md)
- [Bind declarations and separate hook build cohorts](../../decisions/execution/providers/hooks/0364-bind-declarations-to-knowledge-evidence-and-separate-hook-build-cohorts.md)
- [Terminal observation strengthening v1](terminal-observation-strengthening-v1.md)
- [Terminal hook latency outcome](../../roadmap/product-outcome-convergence/foundation/terminal-hook-latency.md)

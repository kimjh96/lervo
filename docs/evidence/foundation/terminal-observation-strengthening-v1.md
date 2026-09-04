# Terminal observation strengthening v1

Status: `passed`

Observed: 2026-09-05

## Conclusion

One current-build Codex cohort passed direct-terminal latency budgets in the latest-33-report window: 33 `UserPromptSubmit` observations and 30 matching `Stop` observations. Prompt p95 was 14,553.077 ms against 15,000 ms; Stop p95 was 1,857.033 ms against 5,000 ms. No retained sample reached the 30-second external ceiling.

The preceding failed profile remains valid evidence. A 100-report diagnostic still returns exit 1 and `blocked`, retaining that profile's Prompt p95 of 17,122.791 ms and Stop p95 of 16,820.386 ms. Profiles remain separated by exact environment-profile digest.

## Cohort protocol

- Provider: `codex`
- Hook contract: `lervo_terminal_hooks_v2`
- Current environment profile: `sha256:f2c894a0c238be56b256a420ea3c5a4e74503389501180553f74e245b7aba55e`
- Repository profile: `custom`
- Cold state: `unknown`; no warm or cold cache cohort is inferred
- Starting population: eight Prompt and six Stop observations
- Added population: 25 sequential fixed-request Prompt/Stop pairs
- Acceptance window: latest 33 reports, containing 33 current-profile Prompt and 30 current-profile Stop observations, with zero missing, incomplete, or invalid stage sets
- Retry policy: no failed hook invocation was retried or removed; all 25 invoked pairs completed
- Percentiles: nearest-rank projection owned by `lervo terminal budget`

The fixed request asked the installed hook to measure the same v0.11.4 follow-up boundary. This operational current-repository cohort is not the provider-free paired benchmark and provides no evidence for other prompts, machines, providers, repository profiles, or future builds.

## Hook latency budget

| Hook | Samples | p50 | p95 | Maximum | p95 budget | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `UserPromptSubmit` | 33 | 10,610.959 ms | 14,553.077 ms | 19,590.543 ms | 15,000 ms | Below |
| `Stop` | 30 | 1,708.459 ms | 1,857.033 ms | 8,085.579 ms | 5,000 ms | Below |

`lervo terminal budget --provider codex --limit 33 --minimum-samples 30 --json` returned exit 0, `passed`, and no reason codes. Both hook maxima remained below 30,000 ms, passing the maximum gate.

## Stage timing

| Hook | Stage | Samples | p50 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: |
| Prompt | `ingress_integrity` | 33 | 1.048 ms | 1.316 ms | 2.825 ms |
| Prompt | `repository_discovery` | 33 | 0.165 ms | 0.277 ms | 0.562 ms |
| Prompt | `lifecycle_inspection` | 33 | 24.140 ms | 29.302 ms | 39.862 ms |
| Prompt | `corpus_preparation` | 33 | 1,825.612 ms | 2,114.089 ms | 2,195.361 ms |
| Prompt | `repository_snapshot` | 33 | 803.218 ms | 934.685 ms | 942.244 ms |
| Prompt | `query_projection` | 33 | 8,225.191 ms | 12,218.689 ms | 17,258.955 ms |
| Prompt | `search` | 33 | 373.816 ms | 439.581 ms | 443.198 ms |
| Prompt | `exact_loading` | 33 | 0.617 ms | 1.038 ms | 1.128 ms |
| Prompt | `context_assembly` | 33 | 0.953 ms | 1.374 ms | 1.514 ms |
| Prompt | `event_commit` | 33 | 13.221 ms | 15.266 ms | 18.014 ms |
| Prompt | `total` | 33 | 10,610.959 ms | 14,553.077 ms | 19,590.543 ms |
| Stop | `ingress_integrity` | 30 | 1.058 ms | 1.538 ms | 1.598 ms |
| Stop | `repository_discovery` | 30 | 0.165 ms | 0.190 ms | 0.199 ms |
| Stop | `lifecycle_inspection` | 30 | 1,591.294 ms | 1,739.754 ms | 7,968.092 ms |
| Stop | `event_commit` | 30 | 115.419 ms | 142.406 ms | 169.651 ms |
| Stop | `total` | 30 | 1,708.459 ms | 1,857.033 ms | 8,085.579 ms |

Prompt time is dominated by the single provider-backed `query_projection` stage; Stop time by lifecycle inspection. Measurements cover only Lervo-owned elapsed work, excluding the main provider turn after prompt preparation.

## Token and cache boundary

Query-projection usage was present for all 33 Prompt observations:

| Counter | Samples | Minimum | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Input tokens | 33 | 11,508 | 11,616 | 11,825 | 11,839 |
| Cached input tokens | 33 | 0 | 0 | 7,680 | 7,680 |
| Output tokens | 33 | 21 | 162 | 196 | 207 |
| Reasoning output tokens | 33 | 0 | 73 | 96 | 101 |
| Total tokens | 33 | 11,574 | 11,784 | 11,846 | 12,005 |
| Context window | 33 | 258,400 | 258,400 | 258,400 | 258,400 |

Counters cover only `query_projection`. Cached input is a subset of input; reasoning output may be a subset of output. Do not sum overlapping categories. Non-provider stages expose duration but no token counter. Direct whole-task usage remains `unsupported` with reason `unmanaged_provider_usage_unobserved`: Lervo cannot attribute the main provider turn, tools, or complete user request from an unmanaged terminal.

The receipt lacks a billing accounting descriptor, price coordinate, currency, tax, discount, and invoice reconciliation, so neither monetary cost nor a billed-cost budget is observable. The configured per-context query-projection token limit is the only enforceable direct-terminal resource ceiling and must not be presented as task cost.

## Fail-closed budget evidence

- Without a query-token ceiling, the current-profile 33-report window returned exit 0 and `passed`.
- With `--max-query-tokens 12006`, every retained projection was below the ceiling; the command returned exit 0 and `passed`.
- With `--max-query-tokens 12005`, the observation at exactly 12,005 tokens became `exhausted`; the command returned exit 1 and `blocked`. Reaching the limit fails closed: the boundary is inclusive.
- With `--limit 100`, the retained prior profile's latency exhaustion remained visible; the command returned exit 1 and `blocked`. The successful profile did not overwrite historical failure.

The 12,005 and 12,006 values are cohort-derived boundary probes, not recommended production policy. A durable operational token ceiling requires separate reviewed authority. Missing or insufficient observations remain `escalation_required`; exhausted configured evidence is `blocked` by default.

## References

- [Execution stage observation and performance](../../specifications/execution/stage-observation-and-performance.md)
- [Scope-complete resource and terminal budgets](../../decisions/operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
- [Prior direct-query operational evidence](terminal-direct-query-projection-operational-v1.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)

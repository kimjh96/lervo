# Lervo foundation observability and performance

Status: `accepted input`

As of: 2026-09-01

## Purpose

Define the minimum resource-accounting and latency foundation required before governed loops, execution graphs, operating or collaboration products, or more autonomous agents. These are proposed contracts and gates, not implementation claims.

## Current evidence

Managed Codex and Claude adapters normalize provider-reported usage into `provider.usage.updated`, bound to a managed `runId`, session, and provider turn. Fields include input, cached input, output, reasoning output, total tokens, and a nullable context window. Claude reports zero separate reasoning output because its current SDK does not expose that count. Malformed or missing usage is an adapter error, not zero.

This does not yet answer, “How many tokens did my request use?” because:

- no general user-request report aggregates primary turns, retries, subagents, tools, evaluators, deliberation, and Lervo model calls;
- usage events exclude model and price coordinates and are not billing statements;
- provider categories and cumulative-update behavior differ, so totals are descriptive and not automatically comparable;
- direct terminal sessions are `unmanaged`: Lervo cannot observe whole-task tokens and may observe only its query-projection usage; and
- an absent observation must not appear as zero usage, zero cost, or successful measurement.

## Local timing observation

Measurements from 2026-09-01 on the current repository and machine:

| Path | Observation | Scope and limitation |
| --- | ---: | --- |
| Direct CLI knowledge query | 1.82–1.99 s across five invocations | End-to-end process time, not inner search latency |
| `pnpm`-wrapped knowledge query | 2.01, 3.28, 9.50, 2.01, and 2.11 s | Tail outlier; cause not isolated |
| Codex `UserPromptSubmit` hook | 21.65 s for one representative request | Includes projection, retrieval, loading, assembly, and persistence |
| Matching Codex `Stop` hook | 11.61 s | One unchanged-root sample including lifecycle inspection and persistence |

The prompt hook finished within the provider's 30-second ceiling with 8.35 seconds of margin; the Stop path is also large for a completion hook. ADR-0326 records 17–33-second candidate observations and a 21.32-second preparation that failed before its receipt. This establishes critical-path latency as a foundation risk, but neither population percentiles nor a phase-level diagnosis.

Existing retrieval benchmarks report millisecond-scale warm engine queries. The larger pipeline causes the timings above; without stage spans, they must not be attributed to the search engine.

## Required causal resource envelope

Each managed user request should have one immutable resource root linked to its workstream and optional assignment, with child coordinates for:

```text
user request
  -> orchestration and context preparation
  -> primary provider session and turns
  -> retries, repair turns, and resumptions
  -> subagents and handoffs
  -> tools, commands, and external calls
  -> verification and publication evaluation
  -> deliberation and improvement evaluation
```

Distinguish logical work from attempts. Retrying an operation must not create another user request or double-count cumulative provider updates. Shared session, cache, and background costs require an explicit allocation rule or must remain `unallocated`, never silently assigned.

## Resource ledger contract

| Dimension | Required meaning |
| --- | --- |
| Source | `provider_reported`, `lervo_measured`, `price_estimated`, `billing_reconciled`, or `unobserved` |
| Scope | Primary agent, subagent, Lervo projection, tool, verification, deliberation, or improvement |
| Unit | Tokens by non-overlapping and subset categories, bytes, calls, duration, and currency |
| Accounting | Provider, adapter, model/pricing coordinate, accounting version, and effective time |
| Completeness | Complete, partial with reason, unavailable, or invalid; never inferred zero |
| Allocation | Exact request, shared/unallocated, or externally billed without task attribution |

`cachedInputTokens` is a subset of input, and reasoning output may be a subset of output. Renderers must not add overlapping categories. A normalized token total does not imply cross-provider equivalence.

Keep monetary values in three distinct states:

1. `estimated`: calculated from observed usage and a versioned price snapshot;
2. `provider_reported`: supplied by an adapter but not independently reconciled; and
3. `billed`: reconciled against an authorized billing source.

Carry currency, price effective time, tax and discount exclusions, rounding, and unknown categories with the value. Delay warning and hard-stop budgets until telemetry is sufficiently complete for the relevant resource scope. Direct unmanaged work must report `wholeTaskUsage: unavailable` while separately exposing observed Lervo-overhead usage.

## Stage-level latency contract

Use a monotonic local clock for durations and wall-clock time only for correlation. Critical paths need bounded spans for integrity verification, repository discovery, provider admission and inference, corpus/index preparation, search, selection, exact loading, assembly, event commit, lifecycle inspection, and cleanup.

Bind each observation to a comparison environment profile: Lervo and adapter build, OS, architecture, Node version, observable provider/model coordinate, repository document and byte counts, cold or warm state, concurrency, and privacy-safe failure code.

Freeze initial candidate budgets only after representative multi-environment baselines. Until then, direct-hook safety targets are:

- no valid sample reaches the provider's 30-second hard ceiling;
- prompt-hook p95 is at most 15 seconds and p99 at most 24 seconds;
- unchanged-root Stop p95 is at most 5 seconds;
- internal failure returns the documented availability-safe result before the p99 budget without recording success evidence; and
- no change regresses a frozen stage or end-to-end p95 by more than 10% unless a reviewed quality or safety tradeoff authorizes it.

These are proposed engineering gates, not current SLOs. If representative data shows they are unrealistic, revise them through review before implementation, not after a failed result.

## Performance methodology

- Measure cold start, warm start, and small, medium, and large registered corpora separately.
- Record p50, p95, p99, maximum, failure rate, timeout rate, CPU time, and peak memory.
- Alternate baseline and candidate order while retaining the same repository snapshot.
- Include concurrency and provider-startup contention; a single idle-machine mean is insufficient.
- Separate deterministic engine latency from provider projection, process startup, filesystem loading, and event persistence.
- Store bounded aggregate evidence; exclude raw prompts, results, credentials, and paths from telemetry.
- Preserve a local provider-free fallback and explicit rollback for every optimized path.

## Immediate work

1. Define the causal resource envelope and deduplication rules before adding goals, routines, or nested execution graphs.
2. Add a read-only managed-request usage projection without monetary hard stops.
3. Add stage spans to direct hooks and managed runs, then collect representative baselines.
4. Diagnose prompt and Stop critical paths from spans rather than aggregate timing.
5. Add versioned price estimation only after model and accounting coordinates can be retained safely; add billing reconciliation and hard budgets later.

## References

- [Foundation-hardening entrypoint](../lervo-foundation-hardening.md)
- [Provider adapter specification](../../specifications/execution/provider-adapters.md)
- [Terminal query-projector ownership](../../decisions/search/engines/0326-pre-admit-terminal-query-projector-under-hook-ownership.md)
- [Availability-safe terminal hooks](../../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Repository retrieval observation](../../evidence/search/repository-retrieval-v1.md)

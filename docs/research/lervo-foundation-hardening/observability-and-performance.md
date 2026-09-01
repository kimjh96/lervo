# Lervo foundation observability and performance

Status: `accepted input`

As of: 2026-09-01

## Purpose

Define the minimum resource-accounting and latency foundation needed before adding
governed loops, execution graphs, operating products, collaboration products, or more
autonomous agents. These are proposed contracts and gates, not implemented claims.

## Current evidence

Managed Codex and Claude adapters normalize provider-reported usage into
`provider.usage.updated`, bound to a managed `runId`, session, and provider turn. Current
fields include input, cached input, output, reasoning output, total tokens, and a nullable
context window. Claude reports zero separate reasoning output because its current SDK
does not expose that count. Malformed or missing usage becomes an adapter error rather
than zero.

This is useful but incomplete for a user asking, “How many tokens did my request use?”

- There is no general user-request resource report that rolls up primary turns, retries,
  subagents, tools, evaluators, deliberation, and Lervo's own model calls.
- Current usage events exclude model and price coordinates and intentionally are not
  billing statements.
- Provider accounting categories and cumulative-update behavior differ, so totals are
  descriptive and not automatically comparable across providers.
- Direct terminal sessions are `unmanaged`; Lervo does not own the provider process and
  cannot observe whole-task tokens. It may observe only its own query-projection usage.
- No observation must be rendered as zero usage, zero cost, or successful measurement.

## Local timing observation

On 2026-09-01 in the current repository and machine:

| Path                           |                                Observation | Scope and limitation                                                           |
| ------------------------------ | -----------------------------------------: | ------------------------------------------------------------------------------ |
| Direct CLI knowledge query     | 1.82–1.99 s across five direct invocations | End-to-end process time; not inner search latency                              |
| `pnpm`-wrapped knowledge query |         2.01, 3.28, 9.50, 2.01, and 2.11 s | Shows a tail outlier; cause was not isolated                                   |
| Codex `UserPromptSubmit` hook  |     21.65 s for one representative request | One sample; includes projection, retrieval, loading, assembly, and persistence |
| Matching Codex `Stop` hook     |                                    11.61 s | One unchanged-root sample; includes lifecycle inspection and persistence       |

The hook completed inside the provider's 30-second ceiling, but the prompt path retained
only 8.35 seconds of margin. The Stop path is also large for a completion-path hook.
Historical ADR-0326 already records 17–33-second candidate observations and a 21.32-second
preparation that failed before its receipt. Together these are sufficient to mark
critical-path latency as a foundation risk, but not to establish population percentiles
or diagnose one phase.

The existing retrieval benchmark reports millisecond-scale warm engine queries. The
seconds above therefore describe a larger pipeline and must not be attributed to the
search engine without stage spans.

## Required causal resource envelope

Every managed user request should have one immutable resource root linked to its
workstream and optional assignment. Child coordinates should cover:

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

The envelope must distinguish logical work from attempts. Retrying the same operation
must not create a new user request or double-count cumulative provider updates. Shared
session, cache, and background costs need an explicit allocation rule or remain
`unallocated`, never silently assigned.

## Resource ledger contract

The proposed ledger should preserve the following distinctions:

| Dimension    | Required meaning                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Source       | `provider_reported`, `lervo_measured`, `price_estimated`, `billing_reconciled`, or `unobserved` |
| Scope        | Primary agent, subagent, Lervo projection, tool, verification, deliberation, or improvement     |
| Unit         | Tokens by non-overlapping and subset categories, bytes, calls, duration, and currency           |
| Accounting   | Provider, adapter, model/pricing coordinate, accounting version, and effective time             |
| Completeness | Complete, partial with reason, unavailable, or invalid; never inferred zero                     |
| Allocation   | Exact request, shared/unallocated, or externally billed without task attribution                |

`cachedInputTokens` remains a subset of input, and reasoning output may be a subset of
output. Renderers must not add overlapping categories. A normalized token total is not
cross-provider equivalence.

Monetary values need three separate states:

1. `estimated`: calculated from a versioned price snapshot and observed usage;
2. `provider_reported`: supplied by an adapter but not independently reconciled; and
3. `billed`: reconciled against an authorized billing source.

Currency, price effective time, tax and discount exclusions, rounding, and unknown
categories must travel with the value. Warning and hard-stop budgets should wait until
the relevant resource scope has sufficiently complete telemetry. Direct unmanaged work
should report `wholeTaskUsage: unavailable`, while separately exposing any observed
Lervo-overhead usage.

## Stage-level latency contract

Use a monotonic local clock for durations and wall-clock time only for correlation. Each
critical path needs bounded spans for integrity verification, repository discovery,
provider admission and inference, corpus/index preparation, search, selection, exact
loading, assembly, event commit, lifecycle inspection, and cleanup.

Every observation should bind the environment profile needed for comparison: Lervo and
adapter build, OS, architecture, Node version, provider/model coordinate when observable,
repository document and byte counts, cold or warm state, concurrency, and privacy-safe
failure code.

Initial candidate budgets should be frozen only after representative multi-environment
baselines. Until then, the direct-hook safety targets are:

- no valid sample may reach the provider's 30-second hard ceiling;
- prompt-hook p95 should be at most 15 seconds and p99 at most 24 seconds;
- unchanged-root Stop p95 should be at most 5 seconds;
- internal failure should return the documented availability-safe result before the p99
  budget, without recording success evidence; and
- a change should not regress a frozen stage or end-to-end p95 by more than 10% unless a
  reviewed quality or safety tradeoff authorizes it.

These values are proposed engineering gates, not current SLOs. If representative data
shows they are unrealistic, change them through review before implementation rather
than moving them after a failed result.

## Performance methodology

- Measure cold start, warm start, small, medium, and large registered corpora separately.
- Record p50, p95, p99, maximum, failure rate, timeout rate, CPU time, and peak memory.
- Alternate baseline and candidate order and retain the same repository snapshot.
- Include concurrency and provider-startup contention; a single idle-machine mean is
  insufficient.
- Keep deterministic engine latency separate from provider projection, process startup,
  filesystem loading, and event persistence.
- Store bounded aggregate evidence and keep raw prompts, results, credentials, and paths
  out of telemetry.
- Preserve a local provider-free fallback and explicit rollback for any optimized path.

## Immediate work

1. Define the causal resource envelope and deduplication rules before adding goals,
   routines, or nested execution graphs.
2. Add a read-only managed request usage projection without monetary hard stops.
3. Add stage spans to direct hooks and managed runs, then collect representative baselines.
4. Diagnose the prompt and Stop critical paths from spans, not from aggregate timing.
5. Add versioned price estimation only after model and accounting coordinates can be
   retained safely; add billing reconciliation and hard budgets later.

## References

- [Foundation-hardening entrypoint](../lervo-foundation-hardening.md)
- [Provider adapter specification](../../specifications/execution/provider-adapters.md)
- [Terminal query-projector ownership](../../decisions/search/engines/0326-pre-admit-terminal-query-projector-under-hook-ownership.md)
- [Availability-safe terminal hooks](../../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Repository retrieval observation](../../evidence/search/repository-retrieval-v1.md)

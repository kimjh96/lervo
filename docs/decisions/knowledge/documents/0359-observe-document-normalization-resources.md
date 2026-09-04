# ADR-0359: Observe document normalization resources

- Status: accepted
- Decision date: 2026-09-04

## Context

Document-normalization provider processes exposed native usage, but the normalization compiler returned only candidate content. Operators could bound source bytes and worst-case call capacity before generation, but could neither distinguish observed token use from unavailable usage nor stop later envelopes after reaching an observed token or elapsed-time threshold.

Including runtime measurements in candidate identity would produce different candidates for identical output bytes. Reusing measurements stored with a shard would incorrectly attribute an earlier provider call to a cache-only execution.

## Decision

Extend the provider-neutral normalization compiler with an additive observed invocation. Codex and Claude adapters translate native usage into `inputTokens`, `cachedInputTokens`, `outputTokens`, and `totalTokens`. A missing or invalid native value becomes `status: unavailable, reason: normalization_usage_unavailable`, never zero. Existing compilers without the observed invocation remain compatible and receive the same explicit unavailable treatment.

Repository-knowledge orchestration measures elapsed time around every compiler invocation and aggregates it with translated usage. The local resource observation records provider-call count, cumulative provider-boundary elapsed milliseconds, and either complete aggregate token fields or unavailable status with observed and unavailable call counts. Cache-only compilation has exactly zero new calls, elapsed time, and tokens. Prompts, document bodies, provider output, model identifiers, prices, and credentials are excluded.

Token and elapsed-time ceilings are optional and unconfigured by default. The CLI accepts `--max-observed-tokens` and `--max-elapsed-ms`; preflight displays them without claiming a future reservation. If either post-call ceiling is configured, provider envelopes run serially so no later envelope starts before the latest observation is evaluated. Reaching an observed token or elapsed-time limit prevents the next provider call with `normalization_budget_exceeded`. If usage is unavailable under a token ceiling, the next call fails closed with `normalization_usage_unavailable`. A completed call may exceed a limit because Lervo neither predicts nor preempts provider usage already in progress.

Resource observations accompany the immediate local generation result but do not affect candidate identity, candidate bytes, approvals, lifecycle records, or applied events. Loading a stored candidate later does not reconstruct or invent its generation usage.

## Consequences

Operators can budget continued normalization using measured provider work while preserving the exact meaning of unknown values. Provider parsing, resource policy, cache ownership, candidate identity, and CLI rendering remain separate. Enabling token or elapsed-time admission exchanges shard concurrency for a race-free post-call boundary; unmetered runs retain bounded concurrency.

This boundary provides resource evidence, not billing, model learning, semantic correctness, approval, or permission to rewrite a document.

## Verification

- Pure observation tests cover aggregation, unavailable usage, elapsed-time and token exhaustion, and fail-closed continuation.
- Compilation tests cover serial admission, cache-only zero attribution, and legacy compiler compatibility.
- Common Codex and Claude process tests cover usage translation, cancellation, timeout, and the no-capability boundary.
- CLI tests cover declared preflight ceilings and measured generation JSON.

## References

- [Document content normalization](../../../specs/document-content-normalization.md)
- [Document normalization evidence renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
- [ADR-0358](0358-bound-document-normalization-worksets-and-preflight.md)
- [Provider adapter specification](../../../specifications/execution/provider-adapters.md)

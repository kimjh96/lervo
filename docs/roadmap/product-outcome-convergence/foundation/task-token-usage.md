# Task token usage

## Managed task usage

State: `implemented`.

Outcome: the user sees the exact observable token usage for one Lervo-managed requested task.

Managed runs report scope-bound normalized token dimensions per exact accounting group. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the governed-loop token-dimension limits and their evidence record; outcome supervision keeps its token ceiling.

Preserve exact accounting groups and fail closed when a configured ceiling requires an unobservable dimension.

## Direct unmanaged whole-task usage

State: `external dependency`.

Outcome: the user sees the exact provider token usage and monetary cost for one direct unmanaged terminal task.

[Current direct-terminal evidence](../../../evidence/foundation/terminal-hook-latency-requalification-v2.md) retains only per-context query-projection usage. Direct whole-task usage remains `unsupported: unmanaged_provider_usage_unobserved`; projection counters are neither task totals nor billed cost. Lervo cannot complete this outcome unless the direct provider surface exposes task-bound usage and an applicable versioned price coordinate.

Bind provider-turn usage only when the provider makes it observable. Otherwise keep whole-task usage and monetary cost explicitly unsupported. Never add projection usage to an unobserved task total.

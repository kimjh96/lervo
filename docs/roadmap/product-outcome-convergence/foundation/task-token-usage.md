# Task token usage

Outcome: the user sees how many tokens one requested task consumed.

State: `partial`.

Managed runs report scope-bound normalized token dimensions and can enforce total, input, cached-input, output, and reasoning-output limits when their exact accounting group is complete. [Managed execution resource budget evidence](../../../evidence/foundation/managed-execution-resource-budgets-v1.md) covers that installed boundary. [Current direct-terminal evidence](../../../evidence/foundation/terminal-hook-latency-requalification-v2.md) retains only per-context query-projection usage. Direct whole-task usage remains `unsupported: unmanaged_provider_usage_unobserved`; projection counters are neither task totals nor billed cost.

Completion proof: bind provider-turn usage to the direct turn only when observable. Otherwise keep whole-task and monetary cost explicitly unsupported. Never add projection usage to an unobserved task total.

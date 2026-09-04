# Task token usage

Outcome: the user sees how many tokens one requested task consumed.

State: `partial`.

Managed runs can report scope-bound resource observations. [Current direct-terminal evidence](../../../evidence/foundation/terminal-observation-strengthening-v1.md) reports the complete duration tree and 33 query-projection token/cache observations. Whole-task usage remains `unsupported: unmanaged_provider_usage_unobserved`. Only the provider-backed projection stage has token counters; these are neither task totals nor billed cost.

Completion proof: bind provider-turn usage to the direct turn only when observable. Otherwise keep whole-task and monetary cost explicitly unsupported. Never add projection usage to an unobserved task total.

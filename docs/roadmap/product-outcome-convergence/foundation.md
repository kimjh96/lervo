# Foundation outcomes that remain open

Part of [Product outcome convergence](../product-outcome-convergence.md); its baseline, acceptance-state definitions, and claim boundaries apply.

## Task token usage

Outcome: the user sees how many tokens one requested task consumed.

State: `partial`.

Managed runs can report scope-bound resource observations. [Current direct-terminal evidence](../../evidence/foundation/terminal-observation-strengthening-v1.md) reports the complete duration tree and 33 query-projection token/cache observations. Whole-task usage remains `unsupported: unmanaged_provider_usage_unobserved`. Only the provider-backed projection stage has token counters; these are neither task totals nor billed cost.

Completion proof: bind provider-turn usage to the direct turn only when observable. Otherwise keep whole-task and monetary cost explicitly unsupported. Never add projection usage to an unobserved task total.

## Terminal hook latency

Outcome: terminal hooks meet reviewed latency budgets.

State: `implemented`.

One current-build Codex profile passed with Prompt p95 14,553.077 ms across 33 samples and Stop p95 1,857.033 ms across 30 samples. Both maxima remained below 30 seconds. The prior failed profile remains retained; a 100-report view still blocks on its p95 exhaustion. Per-context token exhaustion also blocks at the inclusive configured boundary.

Ongoing proof: keep profile-separated 30-sample operational evidence current after material hook changes. A monetary cost budget remains unavailable until an accounting and price coordinate is observable.

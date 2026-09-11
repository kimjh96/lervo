# Native Events and Usage

Codex and Claude share contract tests and normalize native session, capability-activation, tool, usage, error, and result events without inventing telemetry. Provider-specific MCP configuration, plugin loading, and confirmation remain behind adapter boundaries.

Claude usage comes from the SDK result's cumulative per-model totals. Complete input includes non-cached, cache-read, and cache-creation input; cache-read remains separately observable. Reasoning output is zero because the SDK exposes no separate count. Empty or malformed totals emit `invalid_provider_usage`. Usage excludes cost, model identifiers, prompts, and output and is not a billing statement.

Document normalization uses the same provider-owned native usage parsing but exposes only input, cached-input, output, and total tokens, or explicit unavailable status. Repository-knowledge orchestration owns provider-call elapsed-time aggregation and post-call admission ceilings. Normalization observations remain local operation output, excluded from content identity, reviewed lifecycle records, and applied events.

Both adapters support an opt-in JSON Schema result constraint through native boundaries: Claude uses the SDK output format; Codex uses app-server `turn/start.outputSchema`. Unconfigured turns omit it. Consumers must still normalize and validate constrained results: provider-native schema acceptance proves neither correctness nor semantic use.

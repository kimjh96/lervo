# Adapter Telemetry

## Native events and usage

Codex and Claude share contract tests. They normalize native session, capability-activation, tool, usage, error, and result events without inventing telemetry. Provider-specific MCP configuration, plugin loading, and confirmation remain behind adapter boundaries.

Claude usage comes from the SDK result's cumulative per-model totals. Complete input includes non-cached, cache-read, and cache-creation input; cache-read remains separately observable. Reasoning output is zero because the SDK exposes no separate count. Empty or malformed totals emit `invalid_provider_usage`. Usage excludes cost, model identifiers, prompts, and output and is not a billing statement.

Document normalization uses the same provider-owned native usage parsing but exposes only input, cached-input, output, and total tokens, or explicit unavailable status. Repository-knowledge orchestration owns provider-call elapsed-time aggregation and post-call admission ceilings. Normalization observations remain local operation output; they do not enter content identity, reviewed lifecycle records, or applied events.

Both adapters offer an opt-in JSON Schema result constraint through native boundaries: Claude uses the SDK output format; Codex uses app-server `turn/start.outputSchema`. Unconfigured turns omit it. Consumers must still normalize and validate constrained results: provider-native schema acceptance proves neither correctness nor semantic use.

## Managed process observation

Every adapter exposes synchronous, read-only process observation bound to its exact managed session. Only a transport that directly owns and inspects a native process may report `running` or `exited`.

- Codex app-server reports its owned child-process state.
- Codex Responses reports `no_managed_process`.
- Claude Agent SDK reports `transport_state_unavailable` because the SDK exposes no native process inspection contract.

Session registration, recent events, and successful turns never substitute for process evidence. Managed orchestration records the bounded result after session start, after each terminal turn, and before shutdown without granting agent, assignment, or completion authority. See [ADR-0372](../../../decisions/execution/orchestration/0372-observe-managed-provider-process-state-through-adapters.md).

## Linked-evidence selection boundary

The default-off managed linked-evidence canary uses the adapter boundary for at most one isolated selection turn. Core code owns eligibility, the relational v17 protocol, exact token validation, source reload, E1–E4 separation, and bounded storage. Each adapter owns only its native schema carrier, context delivery, events, usage normalization, result binding, and stop behavior. Disabled and coordinate-ineligible runs create no selection adapter.

The active ordinary managed-run path does not use the selection-turn boundary. Core code deterministically selects the bounded current linked projection before creating the ordinary Codex or Claude task adapter. It creates no selection adapter and requires no provider-specific branch, API key, or user setting.

After adapter start and before candidate injection or a model turn, the canary requires the session to report `toolCalls`, `commandExecution`, and `fileChanges` as `unsupported`. A mismatch records a bounded selection failure and stops the session with zero selection turns. An accepted turn is never retried, repaired, or replaced.

Claude's explicit empty tool list reports `toolCalls` unsupported. Codex app-server 0.150.1 has no thread- or turn-level no-tool control, so an app-server read-only session remains ineligible even with a read-only filesystem sandbox and denied approvals. Sandbox and approval settings must never prove tools or commands unavailable.

## Selection-only Responses transport

Codex offers an opt-in, selection-only Responses API transport. It accepts only read-only sessions without capability activations and requires an explicit API credential and model. Every request binds `tools: []`, `tool_choice: "none"`, `store: false`, and the existing strict JSON Schema result constraint. Its effective tool, command, file-change, and compaction capabilities are unsupported.

Missing configuration makes no HTTP request. Non-message output, incomplete results, HTTP failure, or invalid usage fails the turn without persisting credentials or provider response bodies. Ordinary managed Codex execution remains on app-server.

The Responses transport is an optional internal BYOK or CI path, not the primary managed-context activation path. General Lervo users need not register provider API keys.

V3's provider-free projection of passed V18 selections was rejected before execution because it added almost no context. V4 proved the deterministic population. v5 binds the implemented runtime: it selects every bounded current linked candidate without creating a selection adapter, then sends only the ordinary read-only task through the existing Codex or Claude adapter and its native signed-in session. No provider-specific selection transport or historical selection telemetry is projected into the current task run.

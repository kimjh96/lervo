# Selection-Only Responses Transport

Codex offers an opt-in, selection-only Responses API transport. It accepts only read-only sessions without capability activations and requires an explicit API credential and model. Every request binds `tools: []`, `tool_choice: "none"`, `store: false`, and the existing strict JSON Schema result constraint. Its effective tool, command, file-change, and compaction capabilities are unsupported.

Missing configuration makes no HTTP request. Non-message output, incomplete results, HTTP failure, or invalid usage fails the turn without persisting credentials or provider response bodies. Ordinary managed Codex execution remains on app-server.

The Responses transport is an optional internal BYOK or CI path, not the primary managed-context activation path. General Lervo users need not register provider API keys.

V3's provider-free projection of passed V18 selections was rejected before execution because it added almost no context. V4 proved the deterministic population. v5 binds the implemented runtime: it selects every bounded current linked candidate without creating a selection adapter, then sends only the ordinary read-only task through the existing Codex or Claude adapter and its native signed-in session. No provider-specific selection transport or historical selection telemetry is projected into the current task run.

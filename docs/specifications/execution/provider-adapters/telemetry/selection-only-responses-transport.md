# Selection-Only Responses Transport

Codex provides an opt-in, selection-only Responses API transport for internal BYOK or CI use. It is not the primary managed-context activation path; general Lervo users need not register provider API keys. Ordinary managed Codex execution remains on app-server.

## Transport contract

The transport accepts only read-only sessions without capability activations and requires an explicit API credential and model. Every request binds `tools: []`, `tool_choice: "none"`, `store: false`, and the existing strict JSON Schema result constraint. Effective tool, command, file-change, and compaction capabilities are unsupported.

Missing configuration causes no HTTP request. Non-message output, incomplete results, HTTP failure, or invalid usage fails the turn without persisting credentials or provider response bodies.

## Selection evidence and current runtime

V3's provider-free projection of passed V18 selections was rejected before execution because it added almost no context. V4 proved the deterministic population.

v5 binds the implemented runtime: it selects every bounded current linked candidate without creating a selection adapter, then sends only the ordinary read-only task through the existing Codex or Claude adapter and its native signed-in session. No provider-specific selection transport or historical selection telemetry is projected into the current task run.

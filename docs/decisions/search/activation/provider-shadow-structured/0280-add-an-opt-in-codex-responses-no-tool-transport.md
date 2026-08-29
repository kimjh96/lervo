# ADR-0280: Add an opt-in Codex Responses no-tool transport

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0279](0279-stop-managed-context-canary-v1-on-command-signal.md) requires a Codex selection transport that can prove tools, commands, and file changes unavailable. Codex app-server 0.150.1 cannot express that boundary: its sandbox and approval controls constrain effects but do not remove the command tool.

The OpenAI Responses API supports explicit tool choice and structured response formats. Lervo needs this transport only for the default-off managed linked-evidence selection turn; ordinary managed Codex execution still requires app-server events and managed-write behavior.

## Decision

Add an opt-in `responses_api_no_tools` transport behind the Codex adapter. A selection request uses an explicit model and API credential, `tools: []`, `tool_choice: "none"`, `store: false`, and the existing strict JSON Schema result constraint. Send managed candidate context and the selection instruction as bounded Responses input items.

The adapter session reports `toolCalls`, `commandExecution`, `fileChanges`, and `contextCompaction` as `unsupported`. It accepts only read-only sessions without capability activations. Ordinary Codex sessions remain on app-server with their existing capability surface.

The CLI composition boundary reads `OPENAI_API_KEY` and `LERVO_CODEX_NO_TOOL_MODEL` only when constructing a `read_only_no_tools` selection adapter. Missing or blank values fail with `capability_activation_failed` before any HTTP request or provider turn. No credential value is stored or emitted.

Reject every non-message response output even when `tool_choice: "none"` was requested. HTTP failures, incomplete responses, unsupported output, and invalid usage totals end the turn as `provider.turn.failed`. Diagnostics contain only bounded failure codes or HTTP status, never response bodies. Successful responses emit the existing session, turn, usage, result, and completion evidence without adding an event or persistent-state contract.

## Consequences

The Codex selection boundary is implementable without weakening the v1 stop, but is not live-ready without the explicit API credential and model. ChatGPT or Codex CLI authentication is not inferred to authorize the Responses API.

This decision does not authorize traffic, v1 replay, default activation, ordinary task transport changes, production routing, or a performance claim. Before paired Codex and Claude execution, a new immutable v2 checkpoint must bind the exact model, source population, transport, request schema, call ceiling, and operator approval.

## Verification

- Prove that the request contains no tools, `tool_choice: "none"`, `store: false`, and the exact JSON Schema.
- Prove that a valid response completes one Codex selection turn with normalized usage.
- Prove that non-message output fails the turn and missing configuration makes zero HTTP requests.
- Run the provider-common boundary and managed-canary tests, repository quality checks, documentation lifecycle, knowledge migration and lint, and exact-base release completion.

## References

- [V1 stop decision](0279-stop-managed-context-canary-v1-on-command-signal.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
- [Natural-language grounding quality roadmap](../../../../roadmap/natural-language-grounding-quality.md)

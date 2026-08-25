# ADR-0010: Claude Agent SDK managed adapter

- Status: `accepted`; ADR-0157 refines input acknowledgement for SDK 0.3.226
- Decision date: 2026-08-18

## Context

The Codex adapter established session, controlled-context, target-turn, and provider-signal contracts, but Claude lacked a managed boundary. A one-shot Claude CLI call cannot prove that context entered a specific session before model invocation. Claude internal subagents would also mix work that never received the role's documents and writing policy into a managed run.

Claude Agent SDK provides startup before queries, caller-selected session UUIDs, streaming user input, replay, session, tool, and result events, and `compact_boundary`. It cannot reliably provide every common usage field or distinguish file creation from modification after a successful file tool.

## Decision

### Process and session

- Place official `@anthropic-ai/claude-agent-sdk` 0.3.226 behind a narrow client port. Pin this release-age-compliant version, which provides the required stable APIs.
- Run `startup` and initialization per session. Pass a Lervo UUID as both SDK `sessionId` and provider session ID.
- Default to read-only `plan` permission mode. Load no filesystem settings, automatic skills, or external MCP configuration. Deny permission requests until Policy Engine integration.
- Block Claude `Agent` and `Task` tools by default. Run specialists as separate Lervo-managed sessions with each role's current-generation envelope. Never call an uninjected internal subagent managed work.
- Mark resume `unsupported`. Cancellation interrupts an active query, then closes input and process.

### Controlled context and turn

Use the shared `@lervo/adapter-contract` materializer for inline and CAS byte-count, SHA-256, and lossless UTF-8 checks.

Encode the verified set as one synthetic user message containing role and writing-policy IDs, policy document ID, target turn, generation, and every document's ID, path, hash, scope, and source. Send it with `shouldQuery=false`.

For SDK 0.3.226, create a `controlledInput=true` receipt only after observing same-UUID `command_lifecycle.started` and init. When replay is present, also verify session ID, message UUID, and exact source. ADR-0157 defines compatibility details.

Send the real task with `shouldQuery=true`; its message UUID is the provider turn ID. Require a context-receipt candidate for the same target turn. A receipt proves verified source entered input history for the next query, not understanding or compliance.

### Signals and capabilities

- Map the first init to `provider.session.started`, matching query lifecycle or replay to one `provider.turn.started`, and result to `provider.turn.completed` or `.failed`. Do not promote context-only lifecycle or zero-turn results.
- Map `compact_boundary` to `provider.context.compacted`; only the orchestrator may invalidate generation after validating coordinates.
- Map Bash results to `provider.command.executed` and other tool results to `provider.tool.called`. A result without a linked use ID cannot be normal completion.
- Mark context compaction, commands, and tool calls `supported`. Mark file-change and usage semantics `unknown`; do not infer `provider.file_change.reported` from a generic file tool.
- Convert observed subagent messages to `unmanaged_subagent_signal`, never normal parent-session telemetry.

### Failures and privacy

| Situation | Meaning |
| --- | --- |
| Invalid adapter/session/turn coordinates or UUID | `invalid_request`/`session_mismatch`; reject before SDK input. |
| Invalid bytes, digest, UTF-8, or CAS read | `context_materialization_failed`; create neither message nor receipt. |
| Mismatched init, session, lifecycle/replay, tool, or turn | `provider_protocol_failed`; claim neither controlled receipt nor normal telemetry. |
| Startup, stream, interrupt, or close failure | `provider_process_failed`; do not claim normal completion. |
| Permission request | Deny until Policy Engine integration; never auto-approve. |
| Unverified usage or file change | Capability `unknown`; infer neither zero nor change kind. |

Context and task prompts remain only in local SDK input. Signals exclude commands, output, tool inputs, model results, absolute paths, and provider error bodies. Retain observable IDs, status, times, and repository-relative working directories; digest sensitive values.

## Consequences

- Claude follows the Codex session, context, and turn contract without changing role, writing policy, or document hashes.
- Context does not invoke the model or produce an E3 candidate before UUID-bound lifecycle and initialization evidence.
- Specialists run as separately managed sessions under the shared-context rules.
- Provider capability gaps remain explicit.

## References

- [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code hooks and compaction lifecycle](https://code.claude.com/docs/en/hooks)

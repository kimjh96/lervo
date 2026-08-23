# ADR-0157: Claude SDK Command-Lifecycle Input Acknowledgement

- Status: accepted
- Decision date: 2026-08-22

## Context

Claude Agent SDK 0.3.226 with bundled Claude Code 2.1.226 acknowledges synthetic input through matching command_lifecycle queued/started/completed, init, and a zero-turn success instead of always replaying the user message. Query results may omit user_message_uuid. Waiting only for replay causes false timeout. Real pilots also showed relative paths misinterpreted outside the working directory.

## Decision

Every available SDK session_id must match the active session. Synthetic context is accepted only after both matching command_uuid lifecycle.started and init; it remains pending until matching completed. Zero-turn non-error result is internal input acknowledgement, never provider-turn or model-use evidence. If replay also arrives, UUID and body must match exactly.

For a query, matching lifecycle.started confirms provider execution. Optional matching replay cannot duplicate provider.turn.started. A present result user_message_uuid must match the active turn; an absent one binds only when exactly one active turn exists. UUID mismatch, ambiguous zero-turn result, timeout, and unexpected stream end fail closed.

Claude tasks receive a short adapter-added boundary containing the resolved repository root as a JSON string. It is path guidance only. Write/Edit hooks still normalize paths and enforce expected path, signed approval, one-use permit, and before/after hashes. Other/outside paths fail rather than being corrected.

Root, context/task text, and raw SDK messages remain only in local process input/memory. Signals, events, databases, receipts, and output gain no paths, bodies, or provider errors. Telemetry meanings and event types remain unchanged.

## Consequences

Lifecycle-only and replay-compatible fixtures verify receipts and no duplicate starts. Isolated real Codex CLI 0.148.0 and Claude SDK 0.3.226 pilots completed managed writes, hashes, verification, and run completion; authenticated pilots are not default CI evidence. Input acceptance now reflects observable UUID-bound protocol without fabricating replay or result fields.

## Reference

- [Claude Agent SDK TypeScript issue 385](https://github.com/anthropics/claude-agent-sdk-typescript/issues/385)
- [ADR-0010](./0010-claude-agent-sdk-managed-adapter.md)

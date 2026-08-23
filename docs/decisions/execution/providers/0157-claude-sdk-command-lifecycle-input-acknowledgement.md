# ADR-0157: Claude SDK Command-Lifecycle Input Acknowledgement

- Status: accepted
- Decision date: 2026-08-22

## Context

Claude Agent SDK 0.3.226 with bundled Claude Code 2.1.226 may acknowledge synthetic input through matching `command_lifecycle` queued/started/completed events, `init`, and zero-turn success instead of replaying the user message. Query results may omit `user_message_uuid`; waiting only for replay causes false timeouts. Real pilots also showed relative paths being interpreted outside the working directory.

## Decision

Every available `session_id` must match the active session. Synthetic context is accepted only after both matching `command_uuid` `lifecycle.started` and `init`, and remains pending until matching `completed`. A zero-turn, non-error result is internal input acknowledgement—not provider-turn or model-use evidence. If replay also occurs, its UUID and body must match exactly.

For a query, matching `lifecycle.started` confirms provider execution. An optional matching replay cannot duplicate `provider.turn.started`. A present result `user_message_uuid` must match the active turn. An absent value binds only when exactly one active turn exists. UUID mismatch, ambiguous zero-turn result, timeout, and unexpected stream end fail closed.

Claude tasks receive a short adapter-added boundary containing the resolved repository root as a JSON string. This is path guidance only. Write/Edit hooks still normalize paths and enforce the expected path, signed approval, one-use permit, and before/after hashes. Other or outside paths fail rather than being corrected.

Root, context/task text, and raw SDK messages remain only in local process input or memory. Signals, events, databases, receipts, and output gain no paths, bodies, or provider errors. Telemetry meanings and event types remain unchanged.

## Consequences

Lifecycle-only and replay-compatible fixtures verify receipts and absence of duplicate starts. Isolated real Codex CLI 0.148.0 and Claude SDK 0.3.226 pilots completed managed writes, hashes, verification, and run completion; authenticated pilots are not default CI evidence. Input acceptance now follows observable UUID-bound protocol without fabricating replay or result fields.

## Reference

- [Claude Agent SDK TypeScript issue 385](https://github.com/anthropics/claude-agent-sdk-typescript/issues/385)
- [ADR-0010](./0010-claude-agent-sdk-managed-adapter.md)

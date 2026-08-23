# ADR-0009: Codex app-server managed adapter

Status: `accepted`
Decision date: 2026-08-18

## Context

M2 established provider-neutral context envelopes and write gates but could not observe which documents reached a Codex process, which turn ran, or when compaction occurred. Existing normalized adapter events also reused append-only Lervo event names, making a provider-reported file change look like a byte-verified `file.changed` event.

`codex exec --json` provides stable JSONL execution events but does not expose the current compaction lifecycle. The experimental app-server command exposes thread creation, model-visible injection, turn lifecycle, items, and `contextCompaction` without enabling experimental API capabilities. Lervo needs that structured boundary for E3 and generation transitions.

## Decision

### Process and session

- `@lervo/adapter-codex` starts one `codex app-server --stdio` process per managed session.
- Complete `initialize`/`initialized`, then bind the `thread/start` thread ID as the provider session ID.
- Default to `read-only` sandbox and `never` approval. Do not approve requests or client tools without an upstream policy decision.
- On cancellation during a turn, call `turn/interrupt`, then complete both `thread/unsubscribe` and process shutdown before returning a stop result.
- Add common `turn_request` and `turn` contracts. Start a target turn only once and only after controlled context was injected for it.

### Controlled context

- Reconstruct inline UTF-8 bytes and resolve CAS material through a narrow caller port.
- Verify every byte count and SHA-256. Reject lossy UTF-8 or any mismatch before injecting an item.
- Create one developer message per document containing role ID, writing-policy ID, document ID/path/hash/scope, and source. Emit no receipt before `thread/inject_items` succeeds.
- The receipt proves only that app-server accepted verified bytes into model-visible history; it does not prove model understanding or compliance.

### Provider signals

- Namespace normalized signals as `provider.*`, separate from append-only source events.
- Signals may contain digests, provider item/turn IDs, status, token counts, and repository-relative paths. Exclude commands, output, tool arguments, diffs, and provider error bodies.
- A Codex file-change item becomes `provider.file_change.reported`, never `file.changed` without an orchestrator permit and verified before/after bytes.
- A completed `contextCompaction` item becomes `provider.context.compacted`; accept deprecated `thread/compacted` only as compatibility input.
- The orchestrator validates project/run/session/provider-session coordinates before converting compaction or restart into `context.invalidated` and a generation increment.
- This slice does not resume provider sessions, so `sessionResume=unsupported`. Directly observed tool, command, file-report, compaction, and usage telemetry are `supported`.

### Failures and privacy

| Situation | Meaning |
| --- | --- |
| Invalid adapter/session/turn coordinates | `invalid_request` or `session_mismatch`; reject before provider invocation. |
| Invalid bytes, digest, UTF-8, or CAS read | `context_materialization_failed`; create neither receipt nor turn. |
| JSONL handshake, response, or schema failure | `provider_protocol_failed`; fail the stream and keep writes closed. |
| Abnormal process exit or unsafe stop | `provider_process_failed`; do not claim normal completion. |
| Unknown server request | Fail closed with a JSON-RPC error; infer no approval or tool execution. |
| Signal from another provider session | `contract_validation_failed`; do not mutate generation or events. |

Raw tasks, context, credentials, stderr, and provider error bodies remain only in process I/O. Persist machine codes and diagnostic digests, not original exceptions.

## Consequences

- Codex session, context, and turn share one thread and fail closed on tampering or premature turn start.
- Provider reports remain visibly distinct from Lervo-verified source events.
- Real compaction closes old E3 once; duplicate signals do not repeatedly increment generation.
- Claude can implement the same turn/signal contract while marking unavailable telemetry `unknown` or `unsupported`.

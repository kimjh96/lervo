# ADR-0009: Codex app-server managed adapter

- Status: `accepted`
- Decision date: 2026-08-18

## Context

M2 established provider-neutral context envelopes and write gates but could not observe which documents reached Codex, which turn ran, or when compaction occurred. Existing normalized adapter events also reused append-only Lervo event names, making provider-reported changes resemble byte-verified `file.changed` events.

`codex exec --json` provides stable JSONL execution events but not the current compaction lifecycle. The experimental app-server command exposes thread creation, model-visible injection, turn lifecycle, items, and `contextCompaction` without enabling experimental API capabilities. Lervo needs this structured boundary for E3 and generation transitions.

## Decision

### Process and session

- `@lervo/adapter-codex` starts one `codex app-server --stdio` process per managed session.
- Complete `initialize`/`initialized`, then bind the `thread/start` thread ID as the provider session ID.
- Default to the `read-only` sandbox and `never` approval. Approve no request or client tool without an upstream policy decision.
- During a turn, cancellation calls `turn/interrupt`, then completes `thread/unsubscribe` and process shutdown before returning a stop result.
- Add common `turn_request` and `turn` contracts. Start each target turn once and only after controlled context injection.

### Controlled context

Reconstruct inline UTF-8 bytes and resolve CAS material through a narrow caller port. Verify every byte count and SHA-256, rejecting lossy UTF-8 or mismatches before injection.

Create one developer message per document with the role ID, writing-policy ID, document ID, path, hash, scope, and source. Emit no receipt until `thread/inject_items` succeeds. The receipt proves only that app-server accepted verified bytes into model-visible history, not model understanding or compliance.

### Provider signals

- Namespace normalized signals as `provider.*`, separate from append-only source events.
- Signals may include digests, provider item and turn IDs, status, token counts, and repository-relative paths. Exclude commands, output, tool arguments, diffs, and provider error bodies.
- A Codex file-change item is `provider.file_change.reported`, never `file.changed` without an orchestrator permit and verified before-and-after bytes.
- A completed `contextCompaction` item is `provider.context.compacted`; accept deprecated `thread/compacted` only as compatibility input.
- Before converting compaction or restart into `context.invalidated` and incrementing generation, the orchestrator validates project, run, session, and provider-session coordinates.
- Session resume is `sessionResume=unsupported`. Directly observed tool, command, file-report, compaction, and usage telemetry are `supported`.

### Failures and privacy

| Situation | Meaning |
| --- | --- |
| Invalid adapter/session/turn coordinates | `invalid_request` or `session_mismatch`; reject before provider invocation. |
| Invalid bytes, digest, UTF-8, or CAS read | `context_materialization_failed`; create neither receipt nor turn. |
| JSONL handshake, response, or schema failure | `provider_protocol_failed`; fail the stream and keep writes closed. |
| Abnormal process exit or unsafe stop | `provider_process_failed`; do not claim normal completion. |
| Unknown server request | Fail closed with a JSON-RPC error; infer no approval or tool execution. |
| Signal from another provider session | `contract_validation_failed`; mutate neither generation nor events. |

Raw tasks, context, credentials, stderr, and provider error bodies remain in process I/O only. Persist machine codes and diagnostic digests, not original exceptions.

## Consequences

- Codex session, context, and turn share one thread and fail closed on tampering or premature turn start.
- Provider reports remain distinct from Lervo-verified source events.
- Real compaction closes old E3 once; duplicate signals do not increment generation repeatedly.
- Claude may implement the same turn and signal contract while marking unavailable telemetry `unknown` or `unsupported`.

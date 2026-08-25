# ADR-0012: Provider-neutral result artifacts

- Status: `accepted`
- Decision date: 2026-08-19

## Context

Normalized provider events omit final response bodies. Users need a separate result source to read successful output and publish shared context. Storing source in terminal events would replicate it through the event store and Hub outbox; arbitrary adapter writes would lose common location, hash, run, and turn guarantees.

## Decision

### Result contract

After terminal completion, `ProviderAdapter.getTurnResult(session, turn)` returns a local `AdapterTurnResult`, separate from normalized events. It contains session and turn coordinates, fixed media type `text/markdown; charset=utf-8`, source, SHA-256, UTF-8 byte count, and production time.

Validate coordinates, schema, lossless UTF-8, production after turn acceptance, the 4 MiB limit, and the actual digest and size. Codex uses the same turn's last completed `agentMessage.text`; Claude uses a successful `result.result`. Missing or mismatched output prevents normal completion.

### Storage and event

Validate in memory after the terminal signal, but store the completion artifact only after adapter shutdown and a successful post-run snapshot.

Write through artifact-store `put`, then `get` the same URI and verify its URI, digest, size, and bytes. The default local CAS URI is `lervo-cas://sha256/<digest>`. For a managed result carrying ADR-0198 E4 metadata, the capture event binds the validated source, while the completion artifact binds a human-facing projection with only exact current-envelope evidence tokens removed.

Derive the artifact ID as `art_<digest>`. `ManagedProviderRunResult` exposes only ID, URI, media type, digest, and byte count; authorized callers read source from local storage.

Set `run.completed.resultDigest` to the human-facing artifact digest and include the single artifact ID. `adapter.result.captured.resultDigest` separately binds the unprojected structured result. Neither event contains the URI or source. Stop, telemetry, or unmanaged-change failure publishes no completion artifact. An object left after a failed completion-event commit is unclaimed and eligible for cleanup.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `provider_result_failed` | A completed signal has no retrievable result; create no normal run result. |
| `contract_validation_failed` | Schema, coordinates, time, UTF-8, size, or digest is invalid; store no source. |
| `artifact_storage_failed` | CAS write or read-back verification failed; record no `run.completed`. |

Source moves only between the local adapter and artifact store. Do not copy it into signals, completion or failure events, diagnostics, or provider errors. Retention, Hub upload, and cross-role publication require separate policy. Artifact existence proves neither writing quality, citations, semantic correctness, nor E4.

## Consequences

- Codex and Claude share one result schema and CAS integrity boundary.
- Users can read the local human-facing result without weakening telemetry minimization.
- Writing verification, shared-context publication, and CLI output use common artifact coordinates rather than provider payloads.
- ADR-0025 binds publication to evaluation and permits; ADR-0013 supplies managed writes.

# ADR-0012: Provider-neutral result artifacts

Status: `accepted`
Decision date: 2026-08-19

## Context

Normalized provider events intentionally omit final response bodies. Without a separate result source, users cannot read successful output or publish it as shared context. Putting it in terminal events would replicate source through the event store and Hub outbox; letting adapters write arbitrary files would lose common location, hash, run, and turn guarantees.

## Decision

### Result contract

- After terminal completion, `ProviderAdapter.getTurnResult(session, turn)` returns a local `AdapterTurnResult`, separate from normalized events.
- It includes session/turn coordinates, fixed media type `text/markdown; charset=utf-8`, source, SHA-256, UTF-8 byte count, and production time.
- Validate coordinates, schema, lossless UTF-8, time after turn acceptance, a 4 MiB maximum, and actual digest/size.
- Codex uses the same turn's last completed `agentMessage.text`; Claude uses a successful `result.result`. Missing or mismatched output prevents normal completion.

### Storage and event

- Validate in memory after terminal signal, but store a completion artifact only after adapter shutdown and post-run snapshot both succeed.
- `put` through the artifact store, then `get` the same URI and verify URI, digest, size, and bytes. Default to local CAS at `lervo-cas://sha256/<digest>`.
- Derive artifact ID deterministically as `art_<digest>`. Expose only ID, URI, media type, digest, and byte count in `ManagedProviderRunResult`; authorized callers read source from local storage.
- Set `run.completed.resultDigest` to the content digest and include the single artifact ID. Do not put URI or source in the event.
- On stop, telemetry, or unmanaged-change failure, publish no completion artifact. An object left after a failed completion-event commit is unclaimed content and a cleanup candidate.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `provider_result_failed` | A completed signal has no retrievable result; create no normal run result. |
| `contract_validation_failed` | Schema, coordinates, time, UTF-8, size, or digest is invalid; store no source. |
| `artifact_storage_failed` | CAS write or read-back verification failed; record no `run.completed`. |

Source moves only between the local adapter and artifact store. It is not copied to signals, completion/failure events, diagnostics, or provider errors. Retention, Hub upload, and cross-role publication require separate policy. Artifact existence alone proves neither writing quality, citations, semantic correctness, nor E4.

## Consequences

- Codex and Claude share one result schema and CAS integrity boundary.
- Users can read local result source without weakening telemetry minimization.
- Writing verification, shared-context publication, and CLI output use common artifact coordinates rather than provider payloads.
- ADR-0025 binds publication to evaluation and permits; ADR-0013 supplies managed writes.

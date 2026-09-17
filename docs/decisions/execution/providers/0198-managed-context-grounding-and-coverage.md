# ADR-0198: Managed context grounding and coverage

- Status: accepted
- Decision date: 2026-08-24

## Context

Managed runs record policy selection as E1, exact loading as E2, and adapter-controlled delivery as E3. The write gate validates that chain, but traces could not reconstruct every selection ground or calculate version-based delivery coverage. The `referenced` state lacked a provider-bound E4 producer.

Delivery does not prove understanding or use. A citation instruction is not evidence unless an observable, coordinate-bound provider result returns an exact identifier for the injected document version.

## Decision

Use one provider-neutral projector in `@lervo/context-coverage` for local and Hub traces. It consumes canonical events and produces a `managed_context` report. Each document-version entry retains all E1 reasons, E2 hashes and source revisions, E3 envelope and receipt coordinates, validated E4 references, highest evidence level, and missing stages.

New `context.injected` payloads include adapter ID, provider session ID, and documents binding every E3 receipt to document ID, content hash, and scope. Legacy E3 remains readable but does not prove exact document-version delivery to the new projector.

Each controlled adapter context includes:

```text
<!-- lervo-e4:<documentId>:<contentHash> -->
```

The accompanying instruction asks the provider to append the exact token as a standalone Markdown HTML comment only when its final response explicitly relies on that document. The instruction is not evidence. After validating a structured `AdapterTurnResult`, the orchestrator atomically records one `adapter.result.captured` and zero or more `context.referenced` events. E4 requires an exact token matching a document in the E3 envelope for the same run, session, provider session, target turn, provider turn, adapter receipt, context generation, content hash, and scope.

The validated adapter result remains the source for capture and E4. Before storing the human-facing artifact, parse CommonMark and remove the complete standalone HTML-comment line only for exact document versions in the current envelope. Empty HTML-comment residue outside code is also removed atomically. Marker-shaped text in fenced, indented, or inline code remains user-visible and establishes no reference. A known token in prose, an inline HTML comment, or another malformed placement fails the result contract instead of deleting only the token and leaving `<!-- -->` residue. Do not hide unknown or forged tokens. Writing evaluation, publication permits, `run.completed`, and CLI output bind to the derived artifact, preventing evidence metadata from affecting prose evaluation or displayed output. An empty projection fails artifact storage. The capture event retains the source result digest.

E4 `output_citation` proves only an observable exact citation in the structured result—not attention, understanding, semantic reliance, agreement, correctness, or internal use.

## Event contracts

### `adapter.result.captured`

Required fields: adapter ID, provider session ID, target turn ID, provider turn ID, result digest, byte count, media type, and `referenceTelemetry: supported`.

Success means the common coordinate, UTF-8, byte-count, hash, size, and time contract passed before the event transaction. Exclude the result body. Validation or commit failure fails the managed run as provider-result or telemetry failure; never fabricate reference availability.

### `context.referenced`

Required fields: E4 evidence receipt ID, injected E3 evidence receipt ID, adapter receipt ID, source result event ID, document ID, exact content hash, scope, provider, provider session, target and provider turns, context generation, `output_citation`, and the bounded exact token.

Every coordinate must match enhanced E3 and the source result event. Unknown, stale, cross-turn, cross-generation, or altered tokens create no E4. Contradictory stored coordinates fail projection closed.

## Coverage

Metrics use unique document versions, not event counts:

- Delivery: required resolved versions with valid enhanced E3 divided by required resolved versions. An unresolved required version returns `null` with `required_version_unresolved`.
- Explicit reference: injected versions with valid E4 divided by injected versions. Missing structured-result telemetry returns `null`; supported telemetry with no exact token yields zero observations.
- Relevance: `null` until reviewed expected-document ground truth exists.
- Candidate selection: selected recommendations divided by recommendations; diagnostic only.

Do not combine scores. A successful managed write requires complete delivery coverage but neither requires nor implies complete reference coverage.

## Local and Hub projection

Full local trace rebuilds the report from canonical local events. The Hub SQLite read model uses the same projector over complete stored run history while keeping event responses paginated. The Hub reader validates report schema and project/run coordinates.

## Privacy and failure meaning

Events may retain repository document IDs, relative evidence coordinates, content hashes, source revisions, provider session and turn coordinates, counts, media type, and the exact bounded token. They exclude prompts, document and result bodies, transcripts, credentials, absolute paths, unrestricted command output, and tool input.

Schema, redaction, result binding, E3 binding, event transaction, and projection inconsistencies fail closed. Missing native telemetry lowers availability and never upgrades evidence. Provider parsing stays behind adapters; the projector and evidence contract are provider-neutral.

## Consequences

Codex and Claude managed runs share one inspectable E1-E4 report and honest telemetry vocabulary. Historical runs remain available but may report legacy E3 or reference telemetry unavailable. Internal model use remains unsupported.

## References

- [Provider-neutral context delivery](0007-provider-neutral-context-delivery.md)
- [Managed provider run lifecycle](0011-managed-provider-run-lifecycle.md)
- [Unmanaged terminal context observation](0197-unmanaged-terminal-context-observation.md)
- [Execution and evidence specification](../../../specifications/execution.md)

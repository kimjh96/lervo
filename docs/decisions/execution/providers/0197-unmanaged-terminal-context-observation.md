# ADR-0197: Unmanaged Terminal Context Observation

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0196 makes direct Codex and Claude terminals invoke Lervo, but four latest-state receipts cannot reconstruct history or bounded coverage. These sessions remain unmanaged because Lervo does not start the provider, obtain an adapter delivery receipt, gate every effect, or observe model internals. Native hooks expose session coordinates; Codex also exposes a turn coordinate, and supported Stop contracts may expose the final assistant message.

## Decision

Record a separate `unmanaged` ladder that is never E1-E4 and never sufficient for managed context or write gates:

1. `prepared`: Lervo queried knowledge, reloaded exact-hash bytes, constructed bounded hook context, and durably recorded preparation before returning it.
2. `referenced`: a native Stop payload contained an exact evidence token for a document version in the matching prepared context.

`prepared` does not prove provider acceptance. `referenced` proves only that observable final output carried the token—not attention, understanding, semantic reliance, agreement, correctness, or internal use. Neither becomes managed E3 or E4.

Each publication receives `<!-- lervo-ref:<conceptId>:<contentHash> -->`. The hook asks the provider to append this exact standalone Markdown HTML comment when its final response refers to the publication. Renderers hide it; raw output retains it for Stop. Stop accepts only a token whose concept ID and hash occur in the latest prepared context for the same provider session and, when available, turn. The v1 parser also accepts legacy `lervo-ref:<conceptId>:<contentHash>` so an in-flight pre-upgrade session can finish. Unknown, stale, and cross-session tokens are ignored.

The projection command is:

```text
lervo terminal coverage [--root <path>] [--provider <codex|claude>] [--limit <1-100>] [--json]
```

It reports each document's highest unmanaged observation, candidate-preparation ratio, explicit-reference ratio, and completion state. Managed delivery is always `null` with `unmanaged_no_adapter_receipt`; relevance is `null` without reviewed ground truth; provider acceptance and internal use are `unsupported`. Missing Stop output is `unavailable`, not zero.

## Event contract

All events use schema version 1, a provider actor, stable opaque run and session IDs derived from the provider session digest, and the terminal-observation policy hash.

### `terminal.context.prepared`

Required fields are observation ID, `executionMode: unmanaged`, provider session and optional turn digests, source snapshot ID, query and returned-context digests, recommendation count, and no more than six loaded-document records. Each record contains concept ID, repository-relative path, content hash, full-or-prefix scope, delivered byte count, assurance, and freshness.

The event must commit before context is returned. Failure returns no context and exits with the provider blocking code.

### `terminal.reference.observed`

Required fields are observation ID, prepared-context event ID, concept ID, repository-relative path, exact content hash, scope, `output_citation`, and provider coordinate digests. Success requires an exact token matching the same prepared context. Failure or mismatch creates no reference event and never upgrades evidence.

### `terminal.turn.observed`

Required fields are observation ID, prepared-context event ID, reference event IDs and count, reference-telemetry availability, lifecycle state, completion result, and provider coordinate digests. References and the turn commit in one transaction before Stop returns.

Missing matching preparation, malformed coordinates, validation or lifecycle failure, or transaction failure makes the hook fail closed. If the provider omits the final message, the turn still records `referenceTelemetry: unavailable`.

[ADR-0327](hooks/0327-availability-safe-unmanaged-terminal-hooks.md) supersedes this availability rule for direct root sessions. Missing preparation and internal lifecycle or persistence failures now return empty success without manufacturing evidence; an observed non-current root turn records `completionResult: allowed`. Attached-worker isolation and malformed endpoint input remain fail closed.

## Privacy and retention

Events contain no raw prompt, returned context body, document body, final assistant message, transcript, provider session or turn ID, absolute path, credentials, or hook configuration. Prompt, context, session, and turn values are one-way SHA-256 digests; provider coordinates are domain-separated before hashing. Paths are repository-relative and schema-bounded.

Normal local retention and optional destination-bound sync apply. Activation receipts remain bounded latest-state diagnostics; canonical events provide history. Terminal observations are excluded from knowledge source snapshots, preventing them from recursively staling knowledge used by the same hook.

## Consequences

Direct terminals gain honest, reconstructable preparation and exact-output-reference evidence. Local and Hub readers can display canonical events; a future Hub read model can reuse the local projection.

Managed delivery, managed E4, relevance review, effect gating, and provider-internal use remain part of managed execution and the managed-grounding roadmap.

## References

- [Fail-closed provider terminal integration](0196-fail-closed-provider-terminal-integration.md)
- [Managed context grounding and coverage](../../../roadmap/context-grounding-coverage.md)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)

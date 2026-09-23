# Event envelope compatibility

The shared reader accepts envelope schema versions 1, 2, and 3, preserving valid mixed hash chains without rewriting bytes or meaning. Version 1 remains the default writer; activated managed execution writes version 2. Version 3 adds bounded [supervision payloads](../outcome-supervision/contracts.md); versions 1 and 2 cannot carry these event types.

The SQLite adapter supports explicitly selected version 3 writes and rejects new events above the selected writer version. Reader capability advertisement alone does not activate writing.

The version-3 reader additionally recognizes `conversation.repository_knowledge.resolved`, a content-bound or legacy-unavailable knowledge-job outcome with completion hash, source event, job and agent IDs, terminal state, attempt count, bounded failure code, optional current knowledge snapshot hash, and timestamp. The allowlist excludes request text, source bytes, provider output, credentials, and absolute paths. `current` requires a knowledge snapshot and no failure code; `pending_review`, `stale`, and `attention_required` are non-success states. This is reader-first compatibility only: the installed conversation writer still uses its earlier synchronous knowledge disposition until the isolated background lifecycle and reader rollout pass [ADR-0427](../../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md).

Repository activation supports explicit `--schema-version 3` with fresh authoritative evidence that all required readers support versions 1, 2, and 3. Its coordinate uses schema version 2; existing version 1 coordinates and version 2 activation identifiers retain their meaning. The default activation target remains version 2. Production Node supervision composition remains open. Existing lower-version drafts retain their established behavior; version 3 does not silently rewrite them.

A supported but malformed envelope is `event_invalid` at the event-contract boundary and an integrity failure where stored bytes are decoded. An unknown integer envelope version is `event_schema_unsupported`; local storage, sync, and Hub intake reject it before mutation. Invalid hashes and payload allowlists remain integrity failures, not unsupported-version failures.

- [Version 2 payload contracts](event-envelope-compatibility/payload-contracts.md)
- [Validation and evidence boundaries](event-envelope-compatibility/validation-and-evidence.md)

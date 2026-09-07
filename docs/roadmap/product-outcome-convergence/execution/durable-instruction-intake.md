# Explicit durable-instruction intake

State: `implemented`

Outcome: an explicit eligible runtime instruction becomes a reviewable durable repository-instruction candidate through an installed intake route.

Evidence:

- `knowledge instruction intake` invokes current-provider no-capability grounding only at the explicit command boundary, persists a bounded local candidate without raw request text, and exposes exact Markdown and candidate hash.
- `knowledge instruction review` requires the exact hash and reviewer identity to apply or reject.
- Apply rechecks the unchanged complete catalog and deterministic plan, writes only the generated instruction, emits the existing privacy-bounded materialization event, and removes the active candidate. The instruction becomes retrievable after the standard knowledge migration.
- Installed tests cover wrong-hash rejection, apply, reject, pending classification, event evidence, and fresh query retrieval. Direct hooks retain zero automatic materialization.

Preserve the explicit candidate-review boundary, bounded active-state retention, recoverable post-event cleanup, and ADR-0327 retrieval-only direct hook.

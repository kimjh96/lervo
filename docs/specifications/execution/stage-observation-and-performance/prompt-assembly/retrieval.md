# Retrieval context and boundaries

In retrieval mode, `apps/cli/src/terminal-prompt-context.ts` assembles current-repository retrieval context with a 28 KiB total bound, a 12 KiB maximum per loaded document, and an 8 KiB workstream context bound. Workstream truncation preserves UTF-8 character boundaries and appends an explicit notice.

Selected publications go to the exact-loading helper. Legacy full-document or prefix records retain content hash, full or prefix scope, delivered byte count, freshness, and assurance. Search, context assembly, and child exact loading receive distinct timing coordinates. Selected count and loaded-document count remain separate.

The [shared runtime preparation contract](../../context-quality/runtime-preparation.md) also supplies exact source passages to retrieval-mode terminal assembly. Each range carries the full-source hash, UTF-8 byte start and end, and section hash. Packing preserves complete source ranges or reports omission; a passage that cannot fit produces an omission notice within the existing terminal envelope.

Legacy terminal receipts understand only full/prefix documents. Section-only passages are not reported as either, and their legacy loading observation stays unobserved. New section receipt writers belong to the separate protocol rollout. Managed full-document delivery remains a complete superset, not a prefix. Passage preparation therefore cannot be inferred to establish a legacy loaded-document receipt, provider injection, or use. This boundary follows the supplied runtime specification; it is not independent verification of implementation execution or installed acceptance.

Attention uses the exact lifecycle cache when available. A cache miss supplies unavailable coverage rather than triggering a fresh lifecycle scan. Returned grounding state abstains with `unmanaged_terminal_retrieval_only`, empty effect coordinates, and ignored durable-instruction state.

Empty local retrieval establishes no absence in another repository or external service. Standalone `lervo-ref` comments are requested only for explicit output references; they prove neither acceptance, understanding, managed delivery, nor use.

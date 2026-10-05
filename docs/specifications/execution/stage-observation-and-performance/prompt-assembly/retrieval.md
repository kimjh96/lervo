# Retrieval context and boundaries

In retrieval mode, `apps/cli/src/terminal-prompt-context.ts` assembles current-repository retrieval context with a 28 KiB total bound, a 12 KiB maximum per loaded document, and an 8 KiB workstream context bound. Workstream truncation preserves UTF-8 character boundaries and appends an explicit notice.

Selected publications go to the exact-loading helper. Records retain content hash, full or prefix scope, delivered byte count, freshness, and assurance. Search, context assembly, and child exact loading receive distinct timing coordinates. Selected count and loaded-document count remain separate.

Attention uses the exact lifecycle cache when available. A cache miss supplies unavailable coverage rather than triggering a fresh lifecycle scan. Returned grounding state abstains with `unmanaged_terminal_retrieval_only`, empty effect coordinates, and ignored durable-instruction state.

Empty local retrieval establishes no absence in another repository or external service. Standalone `lervo-ref` comments are requested only for explicit output references; they prove neither acceptance, understanding, managed delivery, nor use.

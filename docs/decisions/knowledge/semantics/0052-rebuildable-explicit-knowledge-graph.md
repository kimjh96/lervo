# ADR-0052: Rebuildable explicit knowledge graph

Status: `accepted`
Decision date: 2026-08-20

## Context

Events already link runs, documents, roles, verification, deliberation, and knowledge, but manual traversal is difficult. Inferring edges from similarity, embeddings, model judgments, or search would present relationships without evidence as facts. A separate authoritative graph would also complicate local-first recovery.

## Decision

### Projection boundary

- `@lervo/knowledge-graph` deterministically projects allowlist-validated `EventEnvelope` values and knows no provider, Hub, or storage.
- Each relation has schema version, content-derived ID, project, controlled type, controlled directed endpoints, and evidence event/type/run/sequence.
- Connect only IDs/paths explicitly present in payloads. Selection, loading, and injection are separate edges; never infer `used`.
- Do not create edges from similarity, embeddings, model/search output, or UI actions. Events/documents/artifacts remain source; graph is derived.
- Derive relation ID from project/type/endpoints. For repeat evidence retain earliest sequence. Any canonical-ID collision is integrity failure.

### Storage and rebuild

- Hub SQLite stores derived rows in `hub_knowledge_graph_relations` and updates them atomically with accepted event and trace indexes. Unprojectable payload or conflict rolls back the whole batch and yields no durable acknowledgement.
- Missing/stale index version triggers a one-transaction streaming rebuild from ordered events.
- Bounded startup checks metadata only. Explicit audit reprojects all events and detects missing/extra/mutated relations/evidence.
- Loss of graph table loses no source. Use no separate graph database.

### Bounded query and UI

- Query one project's one-hop relations around a focus node (default project node), ordered by relation ID, default 50/max 100, cursor after last relation ID.
- Empty page on an existing project does not prove the focus source exists.
- HTTP `GET /v1/trace/projects/<projectId>/graph` requires destination and either both focus kind/ID or neither. Authenticate `trace.read` and project scope before source access. Return focus, current relations, necessary nodes, and next cursor only.
- `/trace` renders one current page as SVG plus accessible list. Selecting a neighbor refocuses; next page replaces DOM. Keep graph/cursor/token only in tab memory.

Relations contain only allowlisted relative paths/IDs. Exclude bodies, content hashes, prompts, results, reasoning, authorization, credentials, and external identities. Never return cross-project relations or emit events from reads.

Failures distinguish invalid nodes/projection/query, forbidden or absent project, inconsistent page source, and derived-index integrity failure. Integrity failure requires rebuild/operator diagnosis and never a normal graph response.

Fixtures cover deterministic projection/IDs, all controlled relationship types, tamper detection, rebuild/audit, pre-query authorization, focus adjacency, cursor bounds, safe page replacement, token non-persistence, and asset security.

## Consequences

The graph is reproducible locally from events and Hub provides only authorized bounded projection. Multi-hop and semantic relations/search/embeddings are excluded; future search may use the graph only as a verifiable auxiliary signal.

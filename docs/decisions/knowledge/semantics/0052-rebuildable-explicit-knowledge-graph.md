# ADR-0052: Rebuildable explicit knowledge graph

Status: `accepted`
Decision date: 2026-08-20

## Context

Events already link runs, documents, roles, verification, deliberation, and knowledge, but manual traversal is difficult. Similarity, embeddings, model judgments, and search cannot establish factual relationships. A separate authoritative graph would also complicate local-first recovery.

## Decision

### Projection boundary

- `@lervo/knowledge-graph` deterministically projects allowlist-validated `EventEnvelope` values and has no provider, Hub, or storage knowledge.
- Every relation has a schema version, content-derived ID, project, controlled type, controlled directed endpoints, and evidence event, type, run, and sequence.
- Connect only IDs and paths explicit in event payloads. Selection, loading, and injection are distinct edges; never infer `used`.
- Never create edges from similarity, embeddings, model or search output, or UI actions. Events, documents, and artifacts remain authoritative; the graph is derived.
- Derive relation IDs from project, type, and endpoints. For repeated evidence, retain the earliest sequence. Treat any canonical-ID collision as an integrity failure.

### Storage and rebuild

- Hub SQLite stores derived relations in `hub_knowledge_graph_relations`, atomically with accepted event and trace indexes. An unprojectable payload or conflict rolls back the batch and produces no durable acknowledgement.
- A missing or stale index version triggers a one-transaction streaming rebuild from ordered events.
- Bounded startup checks only metadata. Explicit audit reprojects every event and detects missing, extra, or mutated relations and evidence.
- Losing the graph table loses no source data. Do not use a separate graph database.

### Bounded query and UI

- Query one project's one-hop relations around a focus node, defaulting to the project node. Order by relation ID, use default page size 50 and maximum 100, and place the cursor after the last relation ID.
- An empty page for an existing project does not prove that the focus source exists.
- HTTP `GET /v1/trace/projects/<projectId>/graph` requires destination and either both focus kind and focus ID or neither. Authenticate `trace.read` and project scope before source access. Return only focus, current relations, required nodes, and next cursor.
- `/trace` renders one current page as SVG and an accessible list. Selecting a neighbor refocuses. The next page replaces the DOM. Keep graph data, cursor, and token only in tab memory.

Relations contain only allowlisted relative paths and IDs. Exclude bodies, content hashes, prompts, results, reasoning, authorization, credentials, and external identities. Never return cross-project relations or emit events from reads.

Distinguish invalid nodes, projection, or queries; forbidden or missing projects; inconsistent page sources; and derived-index integrity failures. Integrity failure requires rebuild or operator diagnosis and never returns a normal graph response.

Fixtures cover deterministic projection and IDs, every controlled relationship type, tamper detection, rebuild and audit, authorization before query, focus adjacency, cursor bounds, safe page replacement, token non-persistence, and asset security.

## Consequences

The graph is locally reproducible from events, while Hub exposes only an authorized bounded projection. Multi-hop traversal, semantic relations, search, and embeddings remain excluded. Future search may use the graph only as a verifiable auxiliary signal.

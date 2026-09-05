# Structural projection, branch repair, and stage convergence

## Canonical sources and projections

Reviewed user Markdown and semantic sidecars are canonical. Unreviewed structural bundles, concepts, navigation, inventory, impact, and generation manifests are deterministic projections. Compiler schema 2 stores machine projections under `.lervo/state/knowledge/current/`. The configured publication root is a generated working-tree projection excluded from Git by one bounded managed ignore block. Reviewed concepts, claims, relations, source lineage, instruction bridges, normalization records, and semantic manifests remain tracked under `.lervo/knowledge/`.

## Branch repair and layout migration

An unrecorded structural bundle or concept blocks ordinary refresh with a merge-repair diagnostic, preserves unrecorded bytes, and recommends the exact rebuild plan. `knowledge refresh --rebuild` creates a separate exact plan permitting replacement only of Lervo-owned structural bundle and concept paths. The plan exposes current and desired hashes; apply rechecks them. It authorizes only its listed structural record hashes. Publications, instructions, normalized documents, reviewed claims and relations, and arbitrary user paths remain protected.

Layout migration deletes recorded legacy structural bundle, concept, and manifest paths only after exact hash checks. When legacy and schema-2 projections coexist, schema-2 state takes precedence; regeneration converges the repository. Existing `.gitignore` bytes remain user-owned and require exact migration approval. Initialization creates the bounded publication block only when `.gitignore` is absent.

Independently refreshed branches therefore merge only canonical source changes; an integration head or clean clone rebuilds current navigation without a Hub.

## Ordered stage convergence

Each apply stage records pre-materialization lint, validates every error within its responsibility, and rejects transaction-introduced errors. Unrelated pre-existing errors remain visible as stage warnings so the next ordered stage can run. A warning leaves an issue for an ordered later stage and does not imply that the repository is current. Final completion requires global lint with zero errors.

A stage error means the transaction introduced an issue or failed its owned contract and rolled back. If a post-materialization gate fails, output names bounded `code:path` findings observed while staged artifacts existed and states that rollback removed the staged bytes. A later `publication_missing` result cannot be presented as the rollback cause.

Migration materializes structural prerequisites before dependent bridge and normalization work, repeating until final structural refresh and lint are current. Exact source-snapshot and approval bindings remain unchanged.

`--integration-head` compares the current scan with prior local inventory and reports changed, reused, and removed source counts. Without local state, it performs one full rebuild. `lervo upgrade` plans and reapplies the same integration-head mode. Deferred state cannot claim a newer snapshot.

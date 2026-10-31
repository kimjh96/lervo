# Branch repair and layout migration

## Structural repair

An unrecorded structural bundle or concept blocks ordinary refresh with a merge-repair diagnostic, preserves unrecorded bytes, and recommends the exact rebuild plan.

`knowledge refresh --rebuild` creates a separate exact plan permitting replacement only of Lervo-owned structural bundle and concept paths. The plan exposes current and desired hashes, which apply rechecks, and authorizes only listed structural record hashes. Publications, instructions, normalized documents, reviewed claims and relations, and arbitrary user paths remain protected.

## Publication ownership

A structural publication page under the configured publication root is rebuildable while its first line is the Lervo generated header. Ordinary refresh regenerates an edited page and records the update with reason `regenerate_edited_generated_publication`. Git cannot restore the page because the publication root is ignored. The root holds only recorded generation outputs: layout migration blocks a destination there with `destination_in_publication_root`, document structure operations reject it, and lint warns with `publication_root_unmanaged_file` for any unrecorded file ([ADR-0524](../../../decisions/knowledge/repository/source-intake/0524-keep-user-documents-out-of-the-generated-publication-root.md)).

A page without that header is user-owned. Refresh and `--rebuild` preserve it as a conflict; the plan names `rm '<path>' && lervo knowledge refresh` as the explicit restore path.

## Layout migration and branch integration

Layout migration deletes recorded legacy structural bundle, concept, and manifest paths only after exact hash checks. When legacy and schema-2 projections coexist, schema-2 state takes precedence; regeneration converges the repository.

Existing `.gitignore` bytes remain user-owned and require exact migration approval. Initialization creates the bounded publication block only when `.gitignore` is absent.

Independently refreshed branches merge only canonical source changes. An integration head or clean clone rebuilds current navigation without a Hub. In a clean clone, the first terminal prompt reports the unbuilt state and starts one background build that applies only Git-ignored, Lervo-generated outputs ([ADR-0525](../../../decisions/knowledge/maintenance/0525-bootstrap-knowledge-in-a-fresh-clone.md)).

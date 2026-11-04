# Branch repair and layout migration

## Structural repair

An unrecorded structural bundle or concept blocks ordinary refresh with a merge-repair diagnostic, preserves unrecorded bytes, and recommends the exact rebuild plan.

`knowledge refresh --rebuild` creates a separate exact plan permitting replacement only of Lervo-owned structural bundle and concept paths. The plan exposes current and desired hashes, which apply rechecks, and authorizes only listed structural record hashes. Publications, instructions, normalized documents, reviewed claims and relations, and arbitrary user paths remain protected.

## Publication ownership

A structural publication page under the configured publication root is eligible for edited-page regeneration only when a recorded generation establishes it as an output and its first line is the Lervo generated header. The header alone does not establish recorded-generation provenance. For such a recorded output, ordinary refresh regenerates an edited page and records the update with reason `regenerate_edited_generated_publication`. Git cannot restore the page because the publication root is ignored. The root holds only recorded generation outputs: layout migration blocks a destination there with `destination_in_publication_root`, document structure operations reject it, and lint warns with `publication_root_unmanaged_file` for any unrecorded file ([ADR-0524](../../../decisions/knowledge/repository/source-intake/0524-keep-user-documents-out-of-the-generated-publication-root.md)).

An unrecorded page remains protected even when it carries the generated header. A page without that header is user-owned. Refresh and `--rebuild` preserve these files as conflicts; neither may infer overwrite authority from the path or header. For a page without the header, the plan names `rm '<path>' && lervo knowledge refresh` as the explicit restore path. That removal is a separate user action, not permission for refresh or rebuild to delete protected bytes.

## Layout migration and branch integration

Layout migration deletes recorded legacy structural bundle, concept, and manifest paths only after exact hash checks. When legacy and schema-2 projections coexist, schema-2 state takes precedence; regeneration converges the repository.

Existing `.gitignore` bytes remain user-owned and require exact migration approval. Initialization creates the bounded publication block only when `.gitignore` is absent.

Independently refreshed branches merge only canonical source changes. An integration head or clean clone rebuilds current navigation without a Hub. In a clean clone, the first terminal prompt reports the unbuilt state and starts one background build that applies only Git-ignored, Lervo-generated outputs ([ADR-0525](../../../decisions/knowledge/maintenance/0525-bootstrap-knowledge-in-a-fresh-clone.md)).

## Deferred migration documents

[ADR-0540](../../../decisions/knowledge/documents/routing/0540-account-for-every-document-a-migration-defers.md) requires one stated outcome per legacy candidate: moved, retained with evidence, or deferred with a resolution. Any deferral makes migration coverage incomplete. It does not prevent other migration stages from proceeding.

`lervo migrate knowledge --provider <codex|claude>` classifies one bounded pending batch before planning moves. Classification writes host-private evidence. Moves use the same exact plan and item approvals. Without an admitted provider, a root document such as `TRACE.md` remains visible as `provider_unavailable`. Text output leads with the deferred count. JSON retains all deferred paths and resolutions through subsequent stages.

Background classification includes paths outside the delegation roots. Repository writes retain the existing authority fence. Renewal collects all classified outside-root moves in one scope-change proposal, including exactly the missing source, destination, and reference-rewrite file paths required by the atomic plan, with classification and destination per source. Proposals within the root-count limit follow the owner scope-change decision and recommend acceptance. Retained application content never enters that proposal.

Under [ADR-0559](../../../decisions/knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md), a `delegation_scope_change` proposal with `acceptanceBlocker: normalization_root_limit` becomes an `info` finding and remains in the continuity projection as evidence. It is not presented as an owner scope grant that cannot be accepted. Its remediation points to the foreground layout decision, through which the owner can approve the exact reviewed moves once without expanding the background delegation. No partial scope or broader directory grant substitutes for the complete proposal. The [layout and routing contract](../../repository-knowledge-compilation/structural-publication/policy/layout-and-routing.md) defines compatibility, the existing root-count bound, privacy, and the ADR-0535 deferral-health integration surface.

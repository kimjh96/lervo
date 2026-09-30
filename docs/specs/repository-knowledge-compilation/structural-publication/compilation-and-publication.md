# Structural Compilation and Publication Lifecycle

## Structural compilation

`lervo.structural@2` is deterministic, bounded, read-only, and tool-free. It produces generated indexes and pages; two-hex-sharded structural bundles and concepts; a compact current inventory; a source-unit summary; an impact projection; and one manifest binding generated paths and hashes.

Rebuildable outputs live below ignored `.lervo/state/knowledge/current/` or the ignored configured publication root. Reviewed claims, relations, concepts, lineage, bridges, normalization records, and semantic manifests remain tracked canonical records. The compiler retains no historical full source-unit projections and claims only organization and provenance with `unreviewed` assurance.

A bounded read-only lifecycle inspection may share one prepared scan with instruction, layout, structural, bridge, normalization, and lint consumers. Each validates project and policy coordinates; the scan cannot survive repository mutation.

The direct-terminal host may cache the resulting knowledge-only issue projection in `.lervo/state`, keyed by exact CLI version, repository snapshot revision, and supplemental-source digest. This disposable derived state is neither a canonical knowledge record nor a completion event.

## Inventory and currency

Inventory displays the structural publication-input snapshot, excluding revision metadata, verification, events, and local-only agent surfaces. The same eligible source set supplies all displayed kind counts, byte totals, excluded counts, and unsupported counts.

Unequal host histories and Git revision availability cannot change shared publication bytes. Full inventory and query evidence retain those local sources. Query and normalization may use broader snapshots without making publication stale. Only manifest validation, lint, and the current migration plan determine currency.

## Bounded publication lifecycle

Navigation obeys entry and UTF-8 byte limits. New topics create files; empty categories create no paths.

Refresh computes the complete desired set and deletes obsolete output only when the prior generation records its current hash. Edited or unrecorded output conflicts. Cleanup removes empty generated parents.

`.lervo/state/knowledge/current/structural/manifests/current.json` records structural ownership. Refresh replaces it and deletes exact-hash legacy structural manifests and structural outputs during schema-2 migration, while preserving semantic manifests and immutable review and evidence.

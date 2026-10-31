# Integration preflight

Preflight validates delegation and source currency, obtains integrated draft keys, and calls integration-target synchronization before inspecting any draft. This implements ADR-0450's unconditional synchronization amendment to ADR-0449. The synchronization predicate recognizes exact integrated path/hash pairs.

After resolving the target commit, preflight requires each draft to lie inside delegated canonical roots. Its `beforeHash` must equal the captured source hash, or null for an absent captured target. Preflight reads committed target bytes and checks canonical normalization lineage against the reviewed preimage.

Preflight returns every remaining mismatch as a target ref, path, and observed hash. Integration then parks the batch as `target_diverged` instead of waiting ([ADR-0530](../../../../decisions/knowledge/maintenance/0530-keep-background-knowledge-moving-past-divergent-targets.md)). Preflight checks source currency again after successful traversal. This module does not itself establish the synchronizer's history-preservation algorithm or installed acceptance.

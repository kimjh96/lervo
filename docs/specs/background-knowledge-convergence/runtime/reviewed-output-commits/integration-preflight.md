# Integration preflight

Preflight validates delegation and source currency, obtains integrated draft keys, and calls integration-target synchronization before inspecting any draft. This implements ADR-0450's unconditional synchronization amendment to ADR-0449. The synchronization predicate recognizes exact integrated path/hash pairs.

After resolving the target commit, each draft must lie inside delegated canonical roots. Its beforeHash must equal the captured source hash, or null for an absent captured target. Preflight reads committed target bytes and checks canonical normalization lineage against the reviewed preimage.

A remaining mismatch produces `waiting_authority/canonical_target_diverged` with private snapshot, delegation, ref, commit, path, expected-hash, and observed-hash coordinates. Source currency is checked again after successful traversal. This module does not itself establish the synchronizer's history-preservation algorithm or installed acceptance.

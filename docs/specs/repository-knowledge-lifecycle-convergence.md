# Repository knowledge lifecycle convergence

Status: `active`
As of: 2026-08-30

## Scope

Defines branch repair, ordered stage convergence, completion canonicalization, and repository-rewriter ownership. The main [repository knowledge compilation specification](repository-knowledge-compilation.md) owns scanning, compilation, review, and publication contracts. [ADR-0303](../decisions/knowledge/repository/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md) retains the rationale. The [branch-safe lifecycle roadmap](../roadmap/knowledge/branch-safe-lifecycle.md) orders the remaining migration.

## Structural projection and branch repair

Reviewed user Markdown and reviewed semantic sidecars are canonical. Unreviewed structural bundles, concepts, navigation, inventory, impact, and generation manifests are deterministic projections, even while some remain tracked in the v1 compatibility layout.

An unrecorded structural bundle or concept blocks ordinary refresh with a merge-repair diagnostic. `knowledge refresh --rebuild` creates a separate exact plan that may replace only Lervo-owned structural bundle and concept paths. The plan exposes current and desired hashes; apply rechecks them. Publications, instructions, normalized documents, reviewed claims and relations, and arbitrary user paths remain protected.

The future storage migration separates rebuildable structural projections from tracked reviewed knowledge. It must prove that independently refreshed branches converge after source merge and that a clean clone rebuilds current navigation without a Hub.

## Ordered stage convergence

Each apply stage records pre-materialization lint, validates every error within its responsibility, and rejects errors introduced by the transaction. An unrelated pre-existing error remains visible as a stage warning, allowing the next ordered stage to run. Final completion requires global lint with zero errors.

If the post-materialization gate fails, output names bounded `code:path` findings observed while staged artifacts existed and states that rollback removed the staged bytes. A later `publication_missing` result cannot be presented as the rollback cause.

Migration materializes structural prerequisites before dependent bridge and normalization work, repeating until the final structural refresh and lint are current. Exact source-snapshot and approval bindings remain unchanged. Integration branches reconcile against their current integration head; deferred state cannot claim a newer snapshot.

## Canonicalization assessment

Every repository-changing completion assesses durable outcomes using typed source responsibility, ownership, changed paths, verification, and lifecycle coordinates. Natural-language keyword maps grant no workflow, effect, or write authority.

Behavioral obligations belong in canonical instruction documents. Product, architecture, and lifecycle facts belong in their responsible specification or decision. Executable obligations belong in verification. Mutable next steps belong only in the current workstream. AGENTS is a bounded behavioral entrypoint and route index, not a general knowledge store.

The assessment may report that canonical sources are current, update already-authorized canonical bytes, create a development-pattern review candidate, or retain a bounded pending decision. Repetition, provider agreement, candidate generation, and file presence never automatically promote user-owned content.

## Tool-neutral rewrite ownership

The document ownership registry is authoritative for `lervo_generated`, `managed_blocks`, and reviewed-exact normalization outputs. Knowledge lifecycle operations do not write tracked `.prettierignore` bytes. Existing managed blocks are obsolete adapter projections, not ownership truth, and may be removed once an ownership-aware wrapper is active.

The repository formatter entrypoint derives protected paths directly from the neutral registry before invoking its formatter. Tracked user ignore files remain stable. Formatter, lint autofix, transform, and generator integrations use one adapter contract without adding tool identifiers to canonical ownership policy. A rewriter without a registry-bound adapter must prove identical before-and-after hashes for every protected path or fail closed.

## Failure meaning

- An ordinary refresh conflict preserves unrecorded bytes and recommends the exact rebuild plan.
- A rebuild plan authorizes only its listed structural record hashes.
- A stage warning means a pre-existing issue remains for an ordered later stage; it does not mean the repository is current.
- A stage error means the transaction introduced an issue or failed its owned contract and rolled back.
- A canonicalization candidate is review evidence, not canonical truth or approval.
- A rewriter without neutral ownership evidence is unmanaged and cannot mutate protected bytes through Lervo.

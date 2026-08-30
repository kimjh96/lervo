# Repository knowledge lifecycle convergence

Status: `active`
As of: 2026-08-30

## Scope

Defines branch repair, ordered stage convergence, completion canonicalization, and repository-rewriter ownership. The main [repository knowledge compilation specification](repository-knowledge-compilation.md) owns scanning, compilation, review, and publication contracts. [ADR-0303](../decisions/knowledge/repository/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md) retains the rationale. The [branch-safe lifecycle roadmap](../roadmap/knowledge/branch-safe-lifecycle.md) orders the remaining migration.

## Structural projection and branch repair

Reviewed user Markdown and semantic sidecars are canonical. Unreviewed structural bundles, concepts, navigation, inventory, impact, and generation manifests are deterministic projections. Compiler schema 2 stores machine projections under `.lervo/state/knowledge/current/`. The configured publication root remains a generated working-tree projection excluded from Git by one bounded managed ignore block. Reviewed concepts, claims, relations, source lineage, instruction bridges, normalization records, and semantic manifests remain tracked under `.lervo/knowledge/`.

An unrecorded structural bundle or concept blocks ordinary refresh with a merge-repair diagnostic. `knowledge refresh --rebuild` creates a separate exact plan that may replace only Lervo-owned structural bundle and concept paths. The plan exposes current and desired hashes, which apply rechecks. Publications, instructions, normalized documents, reviewed claims and relations, and arbitrary user paths remain protected.

Layout migration deletes recorded legacy structural bundle, concept, and manifest paths only after exact hash checks. If both legacy and schema-2 projections exist, current schema-2 state takes precedence and regeneration converges the repository. Existing `.gitignore` bytes remain user-owned and require exact migration approval. Initialization creates the bounded publication block only when `.gitignore` is absent. Independently refreshed branches therefore merge only canonical source changes; an integration head or clean clone rebuilds current navigation without a Hub.

## Ordered stage convergence

Each apply stage records pre-materialization lint, validates every error within its responsibility, and rejects errors introduced by the transaction. An unrelated pre-existing error remains visible as a stage warning so the next ordered stage can run. Final completion requires global lint with zero errors.

If the post-materialization gate fails, output names bounded `code:path` findings observed while staged artifacts existed and states that rollback removed the staged bytes. A later `publication_missing` result cannot be presented as the rollback cause.

Migration materializes structural prerequisites before dependent bridge and normalization work, repeating until the final structural refresh and lint are current. Exact source-snapshot and approval bindings remain unchanged. `--integration-head` compares the current scan with the prior local inventory and reports changed, reused, and removed source counts. Without local state, it falls back to one full rebuild. `lervo upgrade` plans and reapplies the same integration-head mode. Deferred state cannot claim a newer snapshot.

## Canonicalization assessment

Every repository-changing completion assesses durable outcomes using typed source responsibility, ownership, changed paths, verification, and lifecycle coordinates. Natural-language keyword maps grant no workflow, effect, or write authority.

Behavioral obligations belong in canonical instruction documents. Product, architecture, and lifecycle facts belong in their responsible specification or decision. Executable obligations belong in verification. Mutable next steps belong only in the current workstream. AGENTS is a bounded behavioral entrypoint and route index, not a general knowledge store.

Terminal preparation records a bounded repository path/hash snapshot in ignored local state. Final declaration compares it with current bytes, classifies changed paths through typed responsibility rules, and automatically records a bounded candidate when implementation or provider-surface evidence has no matching changed canonical target. Candidate records contain hashes and typed coordinates, never prompt text or phrase mappings.

The assessment may report `current`, `candidate`, or `pending`; candidate inspection additionally observes `promoted`, `rejected`, and `stale`. Defer and reject require an exact candidate hash and reviewer identity. Promotion also requires an exact current canonical-target hash with the same responsibility and never writes the target. Repetition, provider agreement, candidate generation, and file presence never automatically promote user-owned content.

## Tool-neutral rewrite ownership

The document ownership registry is authoritative for `lervo_generated`, `managed_blocks`, and reviewed-exact normalization outputs. Knowledge lifecycle operations do not write tracked `.prettierignore` bytes. Existing managed blocks are obsolete adapter projections, not ownership truth, and may be removed once an ownership-aware wrapper is active.

The repository formatter entrypoint derives protected paths directly from the neutral registry before invoking its formatter. Tracked user ignore files remain stable. The common adapter descriptor declares only a capability (`format`, `autofix`, `transform`, or `generate`), managed rules, and content-bound dry-run evidence; canonical ownership policy contains no tool identifier. A rewriter without a registry-bound adapter must prove identical before-and-after hashes for every protected path or fail closed.

## Failure meaning

- An ordinary refresh conflict preserves unrecorded bytes and recommends the exact rebuild plan.
- A rebuild plan authorizes only its listed structural record hashes.
- A stage warning means a pre-existing issue remains for an ordered later stage; it does not mean the repository is current.
- A stage error means the transaction introduced an issue or failed its owned contract and rolled back.
- A canonicalization candidate is review evidence, not canonical truth or approval.
- A rewriter without neutral ownership evidence is unmanaged and cannot mutate protected bytes through Lervo.

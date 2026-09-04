# Branch-safe repository knowledge lifecycle

Status: `complete`
As of: 2026-08-30

## Objective

Make repository knowledge converge through ordinary branch and merge-queue workflows without treating derived projections, tool adapters, or conversation memory as canonical authority.

## Phase 1 — causal repair and diagnostics

- [x] Add an exact `knowledge refresh --rebuild` plan limited to unrecorded structural bundle and concept records.
- [x] Name merge-resolved generation mismatch and its repair command in the human plan.
- [x] Preserve pre-materialization lint, validate stage-owned and newly introduced failures, and report pre-rollback `code:path` findings.
- [x] Surface typed repository failures through Stop and declare state last.
- [x] Name workstream schema paths and limits, and publish the provider timeout range in help.

## Phase 2 — branch-neutral projection storage

- [x] Separate reviewed tracked semantic records from unreviewed deterministic structural projections through a versioned clean-clone migration.
- [x] Remove source-snapshot fan-out from Git merge surfaces and prove that two independently refreshed branches converge after source merge.
- [x] Add integration-head and merge-queue verification that rebuilds projections once without requiring a quiet developer window.
- [x] Evaluate but do not ship a regeneration-marker merge driver after the complete-tree repair contract. Branch-local projections no longer enter Git, and per-file regeneration would weaken whole-tree validation.

## Phase 3 — tool-neutral rewrite ownership

- [x] Stop updating tracked `.prettierignore` managed blocks.
- [x] Provide an ownership-aware formatter entrypoint that consumes the neutral registry without a tracked adapter projection.
- [x] Cover formatter, lint autofix, transform, and generator capabilities through one adapter contract without tool identifiers in canonical ownership policy.
- [x] Remove the existing managed block without changing unrelated user-owned ignore rules.

## Phase 4 — canonicalization completion

- [x] Derive completion assessment from typed changed-path responsibility, ownership, verification, and lifecycle evidence without request keyword maps.
- [x] Automatically author bounded review candidates when durable evidence has no authorized canonical target.
- [x] Bind promotion to exact review and expose current, candidate, pending, promoted, rejected, and stale states through terminal finalization.
- [x] Prove that a new agent receives a promoted behavioral obligation through canonical instruction routing without conversation memory.

## Completion evidence

- Structural compiler schema 2 stores bundles, concepts, inventory, source-unit summaries, impact, and the current manifest below `.lervo/state/knowledge/current/`; reviewed claims, relations, concepts, and semantic manifests remain in `.lervo/knowledge/`.
- Initialization creates the rebuildable-publication ignore block only when `.gitignore` is absent. Migration and upgrade preserve an existing file until its exact user-owned update is approved.
- `--integration-head` reports the prior inventory binding and counts of changed, reused, and removed sources. Upgrade uses the same strategy and an exact re-plan on apply.
- A Git fixture refreshes two branches independently, merges both source commits without generated conflicts, rebuilds the integration head, and repeats from a clean clone without local state or publications.
- Terminal preparation stores only bounded path/hash snapshots in ignored state. New declarations bind every changed noncanonical source exactly once to changed canonical bytes, a reviewable rationale, or proposed Markdown. Candidate bodies remain local state; events and attention projections receive no summary or draft body, prompt text, phrases, or keyword authority.
- Candidate review requires the exact candidate hash and reviewer identity. Promotion also requires an exact current canonical-target hash and never writes user-owned canonical bytes.
- AGENTS uses a constant schema-2 bootstrap. Upgrade replaces exact legacy route blocks, removes promoted-pattern projections, preserves the user region, and replans layout current.
- The durable-instruction planner and materializer retain the strict explicit, additive, low-risk, complete-catalog contract. ADR-0327 later removed effect grounding and materialization from direct unmanaged prompt preparation. No installed direct or explicit intake route currently calls the materializer; that user outcome remains tracked by the [product outcome convergence roadmap](../product-outcome-convergence.md).

## Acceptance

A two-branch fixture can change separate canonical sources, merge, rebuild once, lint current, and produce no tracked adapter churn. A failed stage reports its actual pre-rollback blocker. A busy integration head can reconcile incrementally. Canonicalization tests use typed coordinates and contain no natural-language authority mapping.

## References

- [ADR-0303](../../decisions/knowledge/repository/canonicalization/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md)
- [Repository knowledge compilation](../../specs/repository-knowledge-compilation.md)
- [ADR-0304](../../decisions/knowledge/semantics/0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md)
- [ADR-0362](../../decisions/knowledge/repository/canonicalization/0362-bind-terminal-results-to-canonical-outcomes.md)

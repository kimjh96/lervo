# ADR-0303: Branch-safe knowledge reconciliation and typed canonicalization

Status: `accepted`
Decision date: 2026-08-30

Amended by: [ADR-0533](patterns/0533-remove-the-development-pattern-pipeline.md). Pattern-specific intake and command behavior is retired; shared contracts remain.

## Context

CLI 0.4.2 exposed a coupled lifecycle failure during an eight-branch merge. Structural records from different source snapshots conflicted, while choosing Git ours or theirs produced a set owned by no recorded generation. Structural apply wrote missing publications, global lint found unrelated stale stages, and rollback removed the publications before reporting only a later `publication_missing` symptom. Bridge, normalization, and refresh depended on one another's state, while Terminal Stop reduced a typed repository error to a generic fail-closed sentence. The lifecycle also projected document ownership into tracked `.prettierignore`, causing tool-specific churn.

Repository-change finalization required a canonicalization disposition without defining where durable outcomes belong. Agents could therefore use AGENTS as general memory despite its bounded behavioral-entrypoint role.

## Decision

### Branch and repair boundary

Reviewed user Markdown and semantic records remain canonical. Unreviewed structural bundles, concepts, navigation, inventory, impact, and generation manifests are deterministic projections. Compiler schema 2 stores structural machine records below ignored `.lervo/state/knowledge/current/` and generated publications in an ignored configured publication root. Reviewed semantic records remain tracked below `.lervo/knowledge/`, preventing ordinary branches from merging source-snapshot projections.

V1 adds an explicit `knowledge refresh --rebuild` plan. It may replace only unrecorded structural bundle and concept paths under the Lervo-owned registry. The exact plan exposes every current and desired hash, and apply rechecks them. It must not overwrite an unrecorded publication, instruction, normalized document, reviewed claim or relation, or arbitrary user path. Normal refresh identifies a likely merge-resolved generation mismatch and directs users to the bounded repair plan.

No repository-level merge driver is shipped. Git invokes external drivers per file before the full merged source tree exists, and `.gitattributes` cannot portably install the required local driver definition. Moving rebuildable projections out of Git removes the conflict surface while preserving whole-tree planning and validation. A per-file regeneration marker would add machinery without restoring stronger evidence.

### Ordered convergence and diagnostics

Each apply stage validates its responsibility and rejects every newly introduced error. A pre-existing unrelated error remains visible as a downgraded stage warning so the next ordered stage can run. Stage-owned errors always block. Final lifecycle completion still requires global lint with zero errors; this is convergence, not relaxed completion.

If a post-materialization check fails, the CLI reports the exact bounded `code:path` findings observed while staged artifacts existed, states that rollback removed them, and must not report a post-rollback missing artifact as the cause. Migration coordinates structural materialization before dependent bridge and normalization work, repeating until the final structural refresh and lint are current.

Source-snapshot and approval bindings remain exact. Busy integration branches reconcile once against the integration head. The incremental plan reuses prior inventory comparisons and reports changed, reused, and removed source counts; a clean clone performs one full rebuild. Upgrade uses the same mode and exact re-plan. Deferral does not make stale branch projections current. Plan IDs remain snapshot-bound. A future one-shot plan/apply surface may eliminate scripting races only when the supplied candidate and item approvals independently bind the same bytes.

### Terminal and validation diagnostics

Terminal lifecycle inspection catches typed repository failures at every subsystem boundary and returns a bounded code, safe domain detail, and next command. It never echoes prompt or provider configuration bytes. Usage text is reserved for parse errors. Terminal declaration is last: any later repository-authored byte change or commit makes it stale.

Schema failures identify their JSON path and violated bound. Timeout help states the supported range before execution.

### Canonicalization routing

Every repository-changing completion assesses canonicalization using typed source responsibility, ownership, changed paths, verification, and lifecycle state. Natural-language keyword maps are not authoritative and must not be introduced for requests such as remembering, documenting, knowledge capture, or conventional commits.

Behavioral obligations belong in canonical instruction documents. Product, architecture, and lifecycle facts belong in the responsible specification or decision. Checks belong in executable verification, and mutable continuation belongs in the workstream. AGENTS remains a short entrypoint and route index.

Terminal preparation retains a bounded path/hash snapshot in ignored state. Declaration compares typed path responsibilities and automatically creates a bounded review candidate when changed durable evidence has no matching canonical target. Candidate records exclude prompt text and lexical routing fields. Exact-hash review can defer, reject, or promote a candidate against an already-written compatible canonical target; promotion never writes user-owned content. Repetition, provider agreement, and candidate generation never auto-promote user-owned content.

[ADR-0362](0362-bind-terminal-results-to-canonical-outcomes.md) later strengthens this path: new direct-terminal declarations bind every changed noncanonical source to exact canonical target bytes, a reviewable rationale, or proposed Markdown. Draft bodies remain local candidate state, not event content or canonical truth.

### Tool-neutral rewrite ownership

The document ownership registry is the sole ownership authority. Knowledge lifecycle operations no longer project tracked `.prettierignore` bytes because that Prettier adapter caused branch conflicts and duplicated neutral state. Repository-local, ownership-aware formatter wrappers derive protected paths from the registry. Tracked user ignore files remain user-owned and stable. Other formatters and autofix tools use the same neutral adapter contract instead of adding tool names to repository knowledge policy.

## Consequences

The migration makes merge damage recoverable for legacy layouts and removes new structural projection conflicts from Git. Existing user-owned ignore files require exact approval, so upgrade can pause at a visible authority boundary. Integration heads and clean clones rebuild from canonical sources without a Hub. Automatic canonicalization candidates improve continuity without turning conversation memory or provider agreement into authority.

## Verification

- A modified unrecorded concept blocks normal refresh, becomes an exact update only under `--rebuild`, applies, and lints current.
- Stage lint retains pre-existing unrelated errors, rejects new or stage-owned errors, and prints pre-rollback coordinates.
- Stop returns a safe typed bridge failure rather than the generic fallback.
- Workstream validation names `/notes` and its 32-item bound; help names the normalization timeout range.
- Generated agent guidance routes durable outcomes without a natural-language keyword table.
- Repository layout, normalization, and document moves leave `.prettierignore` unchanged while the repository formatter wrapper consumes neutral ownership records.
- Two independently refreshed branches merge without tracked projection conflicts; integration-head and clean-clone rebuilds lint current.
- Upgrade preserves existing `.gitignore` bytes until the exact publication-ignore migration is approved, then resumes.
- Typed canonicalization tests cover current, candidate, pending, promoted, rejected, and stale without request keyword maps.

## References

- [Repository knowledge compilation](../../../../specs/repository-knowledge-compilation.md)
- [Evidence-bound development-pattern promotion](../0220-evidence-bound-development-pattern-promotion.md)
- [Branch-safe lifecycle roadmap](../../../../roadmap/knowledge/branch-safe-lifecycle.md)

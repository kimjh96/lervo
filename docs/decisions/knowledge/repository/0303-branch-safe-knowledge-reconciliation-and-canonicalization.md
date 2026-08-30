# ADR-0303: Branch-safe knowledge reconciliation and typed canonicalization

Status: `accepted`
Decision date: 2026-08-30

## Context

CLI 0.4.2 exposed a coupled lifecycle failure during an eight-branch merge. Structural records from different source snapshots conflicted, and choosing Git ours or theirs produced a set owned by no recorded generation. Structural apply wrote missing publications, global lint found unrelated stale stages, and rollback removed the publications before reporting only a later `publication_missing` symptom. Bridge, normalization, and refresh each depended on another stage's state, while Terminal Stop reduced a typed repository error to a generic fail-closed sentence. The lifecycle also projected document ownership into tracked `.prettierignore`, causing tool-specific churn.

Repository-change finalization required a canonicalization disposition without defining where durable outcomes belong. Agents could therefore turn AGENTS into general memory despite its role as a bounded behavioral entrypoint.

## Decision

### Branch and repair boundary

Reviewed user Markdown and semantic records remain canonical. Unreviewed structural bundles, concepts, navigation, inventory, impact, and generation manifests are deterministic projections. Their tracked v1 representation is a compatibility boundary, not the long-term source of truth. A later versioned migration will separate rebuildable structural projections from reviewed tracked knowledge so ordinary branches do not merge source-snapshot projections.

V1 adds an explicit `knowledge refresh --rebuild` plan. It may replace only unrecorded structural bundle and concept paths under the Lervo-owned registry. The exact plan exposes every current and desired hash, and apply rechecks them. It must not overwrite an unrecorded publication, instruction, normalized document, reviewed claim or relation, or arbitrary user path. Normal refresh identifies a likely merge-resolved generation mismatch and points to the bounded repair plan.

A repository-level merge driver is not the immediate repair authority. Git invokes external drivers per file before the full merged source tree exists, and `.gitattributes` cannot portably install the required local driver definition. A future driver may write an explicit regeneration marker or trigger a post-merge plan, but it must never select one generation and claim that a mixed set is current.

### Ordered convergence and diagnostics

Each apply stage validates its responsibility and rejects every newly introduced error. A pre-existing unrelated error remains visible as a downgraded stage warning so the next ordered stage can run. Stage-owned errors always block. Final lifecycle completion still requires global lint with zero errors; this is convergence, not relaxed completion.

If a post-materialization check fails, the CLI reports the exact bounded `code:path` findings observed while staged artifacts existed and states that rollback removed them. It must not report a post-rollback missing artifact as the cause. Migration coordinates structural materialization before dependent bridge and normalization work, repeating until the final structural refresh and lint are current.

Source-snapshot and approval bindings remain exact. Busy integration branches reconcile once against the integration head; deferral does not make stale branch projections current. Structural-projection separation and incremental compilation reduce this cost without weakening freshness claims. Plan IDs remain snapshot-bound. A future one-shot plan/apply surface may eliminate scripting races only when the supplied candidate and item approvals independently bind the same bytes.

### Terminal and validation diagnostics

Terminal lifecycle inspection catches typed repository failures at every subsystem boundary and returns a bounded code, safe domain detail, and next command. It never echoes prompt or provider configuration bytes. Usage text is reserved for parse errors. Terminal declaration is last: any later repository-authored byte change or commit makes it stale.

Schema failures identify their JSON path and violated bound. Timeout help states the supported range before execution.

### Canonicalization routing

Every repository-changing completion assesses canonicalization using typed source responsibility, ownership, changed paths, verification, and lifecycle state. Natural-language keyword maps are not authoritative and must not be introduced for requests such as remembering, documenting, knowledge capture, or conventional commits.

Behavioral obligations belong in canonical instruction documents. Product, architecture, and lifecycle facts belong in the responsible specification or decision. Checks belong in executable verification, and mutable continuation belongs in the workstream. AGENTS remains a short entrypoint and route index. An agent may update already authorized canonical bytes or create a review candidate. Repetition, provider agreement, and candidate generation never auto-promote user-owned content.

### Tool-neutral rewrite ownership

The document ownership registry is the sole ownership authority. Knowledge lifecycle operations no longer project tracked `.prettierignore` bytes because that Prettier adapter caused branch conflicts and duplicated neutral state. Repository-local, ownership-aware formatter wrappers derive protected paths from the registry. Tracked user ignore files remain user-owned and stable. Other formatters and autofix tools use the same neutral adapter contract instead of adding tool names to repository knowledge policy.

## Consequences

The immediate compatibility patch makes merge damage recoverable, failure output causal, and formatter ownership tool-neutral. It does not complete structural-projection relocation, incremental integration-head refresh, or automatic candidate authoring; the linked roadmap orders that work. Until relocation, teams should run the exact rebuild plan after resolving source merges and include final knowledge lint in integration CI.

## Verification

- A modified unrecorded concept blocks normal refresh, becomes an exact update only under `--rebuild`, applies, and lints current.
- Stage lint retains pre-existing unrelated errors, rejects new or stage-owned errors, and prints pre-rollback coordinates.
- Stop returns a safe typed bridge failure rather than the generic fallback.
- Workstream validation names `/notes` and its 32-item bound; help names the normalization timeout range.
- Generated agent guidance routes durable outcomes without a natural-language keyword table.
- Repository layout, normalization, and document moves leave `.prettierignore` unchanged while the repository formatter wrapper consumes neutral ownership records.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [Evidence-bound development-pattern promotion](0220-evidence-bound-development-pattern-promotion.md)
- [Branch-safe lifecycle roadmap](../../../roadmap/knowledge/branch-safe-lifecycle.md)

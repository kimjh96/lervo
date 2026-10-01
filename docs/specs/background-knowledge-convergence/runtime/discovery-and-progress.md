# Discovery and bounded progress

## Discovery and stages

Startup, canonical event changes, and a 60-second idle inspection discover existing debt and the last ordinary source edit. Event changes use a 30-second quiet window with a 60-second maximum delay. A bounded one-second event-head check supplements filesystem notifications. Only one repository cycle runs at a time; a pending wakeup survives an active cycle.

The seven stages are `assessment`, `canonical_review`, `canonical_integration`, `normalization_generation`, `normalization_review`, `normalization_apply`, and `lifecycle_verification`.

Canonical review retrieves context using bounded terms from the actual source paths and, for Markdown sources, their headings, cited document paths, and explicit `never` clauses. It keeps the knowledge ranker's order. A generic repository-knowledge query is used only when no source supplies a term. This lets a pull-request template retrieve its release and publication contracts instead of filling the review window with unrelated knowledge-lifecycle documents. The existing eight-document recommendation limit, four linked child documents, exact content hashes, source fence, and independent semantic review still apply. Retrieval supplies evidence; it does not establish coverage or approve a draft.

Distinct agents generate, review, write, and integrate under durable provenance-bound assignments. Canonical drafts use a managed detached workspace, verification seal, exact integration ref transition, and exact repository materialization. Normalization compares exact sources, review units, semantic checks, candidate bytes, and independently approved output hashes before applying an accepted subset. Rejected families retain exact rejection evidence, do not repeatedly regenerate unchanged output, and do not block another authorized family.

[ADR-0435](../../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md) retains a rejected canonical batch while handing independent normalization debt to its own review pipeline. The `canonical_review` receipt binds a private `rejection_retained` proof and authorizes no integration. An exact historical rejection is reused without another model call. Ordered projection maintenance may proceed, but final lifecycle verification remains `attention_required/knowledge_semantic_review_rejected`. Rejected and unassessed sources never count as semantic coverage or baseline `current`.

Before acquiring a canonical writer lease, the runtime compares every reviewed target preimage with the selected Git integration ref. Only exact canonically settled normalization lineage can explain an owned preimage change. Other mismatches record `waiting_authority/canonical_target_diverged` with a private exact target-ref/commit dependency. Source or target-ref changes trigger reevaluation; matching target bytes resume the existing review without another model call. Unchanged drafts are invalid semantic changes and cannot start an empty Git integration.

## Settlement, recovery, and verification

The [recovery and retention contract](../recovery-and-retention.md) defines failed-assignment reopening, durable host-effect checkpoints, known completed-ref reconciliation, shared target generations, integrator closure, non-force workspace cleanup, bounded archival, and `assignment.convergence.archived`. Unknown effects remain owned uncertainty.

The owner atomically records a stage, queues its successor, and acknowledges its predecessor. Settlement rechecks canonical source/context, private CAS receipt hashes, authority, and the exact lease. Baseline `current` requires seven verified stage receipts and a stable final lifecycle scan. New sources explicitly supersede old baselines; old terminal events remain immutable.

The version-nine Lervo repository suite prepares detached candidate worktrees with an offline frozen dependency install and local package build before lint, typecheck, and runtime shards. The primary checkout retains its dependency environment. Preparation failure produces no candidate verification receipt or integration success. The integration ref must contain the source being verified.

An interrupted verification result is `knowledge_cancelled`, distinct from an actual `knowledge_verification_failed`. A cancelled stage may resume only after its current source and delegation checks pass under a new live worker signal. Neither result grants verification success.

## Execution bounds and admission

Bounds are 1,024 active obligations, eight stages per cycle, 16 attempts with backoff, eight documents, 1 MiB of source per delegated batch, and eight provider calls. Durable call reservations precede invocation and survive crashes. Private budget projections retain at most 8,192 batches and prune only canonically terminal obligations.

Shared host admission allows two background calls across providers, one per repository, with oldest eligible waiter fairness and admission deferral for active ordinary work. Ordinary work does not preempt an existing call.

Foreground admission defers capability-free provider work for an ordinary assignment's current unexpired lease. Missing or invalid expiry remains fail-closed; expired lease metadata alone cannot defer read-only generation forever. This scheduling predicate neither proves a native process stopped nor settles, cancels, reopens, or removes the expired assignment. Uncertain effects, scoped write conflicts, exact source checks, and integration recovery remain governed by the existing effect and lease contracts. The worker and explicit provider probe share this predicate; caller-supplied current-work observations may remain stricter.

## Complete source capture

Capture defaults are 20,000 paths, 64 MiB per ordinary file, and 256 MiB total. Exceeding applicable bounds requires attention, never partial success.

[ADR-0436](../../../decisions/knowledge/repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) permits an exact reviewed delegation to select a total capture ceiling up to 1 GiB and at most 32 reference-only repository links through optional `sourceCapture`. Every link binds its exact relative target and kind. Targets must separately appear in the complete source inventory; chains and escapes fail closed, and the link remains unchanged.

Opaque descriptor capture establishes no asset acceptance. Canonical worksets obey both reviewed document/source-byte ceilings and the existing canonical request bound, advancing a complete durable cursor. Text review, sensitive local material, and opaque verified assets retain separate dispositions. Tracked assets are never silently classified as generated caches. Pinned before-commits remain reviewable beyond four commits; unavailable dirty history remains explicitly unsupported.

# ADR-0199: Structured workstream continuation state

- Status: accepted (amended 2026-08-24)
- Decision date: 2026-08-24
- Amended by: [ADR-0526](../../execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md) (selection follows the checked-out branch), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (independent cross-check replaces the content-bound approval)
- Amended by: [ADR-0476](../documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)

> **Amended (2026-11-02).** Under [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), the continuation migration no longer takes a content-bound approval. `lervo migrate knowledge --apply <plan-id>` runs an independent cross-check of the exact plan first; the migration then lands as its own `Lervo Knowledge` commit that `lervo knowledge revert <commit>` undoes.

## Context

Lervo previously exempted root `HANDOFF.md` from semantic routing and used it as a short continuation entrypoint. Reviewed normalization could move history into `docs/repository/handoffs/`, but the mutable root file mixed objectives, actions, deployment facts, references, and durable documentation. Its line limit supplied no workstream identity, revision transitions, event binding, automatic provider context, reliable cross-device coordinates, or lifecycle.

`HANDOFF.md` is neither a standard Codex or Claude discovery surface nor a portable repository contract. Existing projects may store active state in session notes, status pages, work logs, issue documents, or arbitrary Markdown; new projects may have none.

## Decision

### Snapshot and lifecycle

Active continuation state uses the provider-neutral `lervo.workstream.v1` snapshot contract. Its local projection is written lazily to `.lervo/state/workstreams/current.json`; no workstream directory exists before the first snapshot. Each snapshot contains:

- Stable workstream ID and monotonic revision.
- Status: `active`, `blocked`, `completed`, or `cancelled`. Cancellation records a stop request; [supervision cancellation reconciliation](../../../specifications/execution/outcome-supervision/implementation/recovery/cancellation.md) separately proves scoped effects are reconciled and requires upgraded transport readers.
- Bounded title, objective, next actions, blockers, current facts, unresolved decisions, and approvals.
- Repository-relative references, immutable origin coordinates, and update time.

Unresolved decisions and approvals retain choices or exact binding coordinates needed by the next agent, excluding resolved history. The working agent resolves natural-language user responses. Resolved items leave current state; durable outcomes move to canonical documentation.

Every committed snapshot is stored byte-for-byte in local CAS and emits `workstream.snapshot.recorded`. The event contains workstream ID, revision, status, change kind, current and previous snapshot hashes, content-addressed artifact coordinates, optional legacy-source artifact coordinates, and time. It excludes objective, action, blocker, note, reference text, absolute path, provider text, prompt, credential, and source body. Missing events, mismatched projections, or missing or invalid current snapshot artifacts invalidate workstream context and fail terminal completion closed. Legacy HANDOFF migration retains the source artifact locally.

### Commands and successors

`lervo workstream current` reads verified current state; `--context` returns bounded agent context and `--json` returns the structured snapshot.

`lervo workstream start` accepts bounded semantic fields, derives system identity and created origin, and uses reproducible plan/apply. It supports recovery and inspection. Provider integration instructs the working agent to invoke it, rather than the user.

`lervo workstream update` accepts a complete v1 JSON snapshot, creates a read-only plan, requires its exact plan ID for apply, preserves workstream identity and origin, and requires revision to increase by exactly one. [ADR-0462](../../execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md) moves revision, update time, and observed HEAD to the service, adds JSON merge patches and one-call `--apply-now`, and rolls notes with a recorded dropped count.

After a settled `completed` or `cancelled` head with no blockers, pending decisions, or approvals, `lervo workstream start` may create a new local workstream ID at revision 1 in the same repository. A `cancelled` snapshot alone is a stop request, not proof of settlement; scoped assignments and effects must be reconciled under the cancellation contract. Its `successor` origin records only the predecessor workstream ID and exact snapshot hash; its `workstream.snapshot.recorded` event links that hash as `previousSnapshotContentHash`. The current projection is atomically replaced, retaining the predecessor event and CAS artifact. An active, blocked, or otherwise unsettled head cannot be replaced, including a cancelled head whose scoped effects remain unreconciled. The start plan binds the exact predecessor hash; a changed head requires replanning. A successor creates a new goal and request-binding scope, not a revision or amendment of the predecessor goal.

This local successor rule does not extend Hub successor transitions. ADR-0201 requires a completed predecessor for its single-head successor publication and a matching completed local head for successor import. A locally settled cancellation does not satisfy that completed-predecessor condition, and cancellation must not be translated to completion to enable transport.

### Provider context and completion

Managed runs add a present current workstream as a required `repository.workstream` context candidate with ordinary E1 selection, E2 exact-byte loading, and provider-adapter E3 delivery.

Direct Codex and Claude hooks prepend at most 8 KiB of verified workstream context. They record workstream ID, revision, exact snapshot hash, delivered byte count, full or prefix scope, and repository revision prepared for the turn. Unchanged turns create no artificial continuation history. When repository-authored bytes change, Stop requires a first snapshot if none existed at prompt preparation, or a revision greater than the prepared revision. Before completion, the working agent records `agent_start` or `agent_update` with its provider coordinate. Unmanaged preparation proves neither provider acceptance nor use.

### Migration and durable knowledge

Before layout work, `lervo migrate knowledge` safely scans included Markdown throughout the repository. It ranks continuation candidates using bounded name, title, objective, next-action, blocker, current-state, and active-language signals; path and basename alone never suffice. One unambiguous candidate may be planned automatically. Multiple candidates block until an exact `--continuation-source` is supplied. Lervo never heuristically merges candidate prose.

Exact-approved apply preserves source bytes in CAS, creates the current projection, and updates resolvable Markdown references to `lervo workstream current`. Only the dedicated root legacy `HANDOFF.md` is deleted, together with its source-owned normalization records. Arbitrary sources may mix active and durable knowledge, so their user bytes remain for reviewed normalization and splitting. One content-bound approval covers every state and user-byte change. Event or validation failure restores every changed file.

With no candidate, the first working agent creates the snapshot during its turn. Structural refresh and reviewed normalization use the same content-aware continuation profile for lasting history documents, regardless of name or location.

Durable architecture, product, operational, and decision facts must move to appropriate canonical Markdown. Completed handoff publications may remain under semantically grouped documentation only when durably valuable; they are not active continuation state.

### Replication

Hub event synchronization does not transfer workstream bodies. The separately authorized repository-scoped replication contract in [ADR-0201](../../coordination/sync/0201-repository-scoped-workstream-replication.md) publishes bounded snapshot revisions and may materialize a newer unique head on another authorized node. Its successor transition requires an exact completed predecessor; the local eligibility of a settled cancelled predecessor does not amend that transport contract. ADR-0526 selects the default-branch workstream as the replicated lineage and leaves ADR-0201's single-lineage Hub contract unchanged. Local use never depends on that transport.

## Failure meaning

- Verification of an existing selected projection binds the latest committed snapshot for that exact workstream ID. A cancellation or update for another independently bound goal cannot replace, resume, or invalidate the selected workstream. A newer conflicting snapshot for the selected ID still blocks verification. Recovery without a selected projection uses the latest recorded snapshot and its exact CAS artifact.
- Invalid or conflicting current state blocks import or update; Lervo does not replace a different active workstream.
- A local successor whose origin does not exactly identify a settled completed or cancelled predecessor fails validation. A cancelled status without reconciled scoped effects is insufficient. Hub successor publication and import separately require ADR-0201's completed-predecessor conditions; local cancellation settlement grants no exception. Distinct unlinked roots remain divergent rather than silently replacing a completed goal.
- A stale plan means the source, reference, lifecycle record, current state, or desired snapshot changed; replanning is required.
- Missing exact approval leaves the selected continuation source and every reference untouched.
- Multiple credible sources remain separate and block automatic migration; Lervo does not infer a merge.
- A repository-changing direct terminal turn cannot complete without creating or advancing its verified checkpoint; an unchanged turn does not advance it.
- Pre-event apply failure rolls back source, state, references, and lifecycle records.
- Committed-event cleanup failure preserves the committed snapshot and requires normal durable recovery.
- Missing provider telemetry never upgrades workstream preparation into acceptance or use.

## Consequences

Repository roots retain only conventional human and provider entrypoints. Workstream state is bounded, revisioned, inspectable, and provider-neutral without assuming a legacy filename or location. Legacy source bytes remain locally recoverable without forcing session history into durable documentation. Managed and unmanaged execution receive the same state with distinct evidence semantics.

The v1 current-state projection remains local node state and is not published through Git. Explicit Hub replication transfers only the bounded snapshot contract across authorized repository nodes; prompts, transcripts, credentials, legacy source bodies, and approval authority do not cross.

[ADR-0200](../../execution/providers/0200-natural-language-terminal-turn-finalization.md) defines changed-turn declarations and conditional checkpoint enforcement. [ADR-0201](../../coordination/sync/0201-repository-scoped-workstream-replication.md) defines cross-node transport and divergence handling.

## Superseded clauses

This decision supersedes ADR-0193's permanent root HANDOFF entrypoint and ADR-0195's retention of root HANDOFF as the active continuation document. Nested historical HANDOFF, SESSION, or CONTEXT documents may still use the reviewed handoff-document format when they are durable repository documentation rather than active state.

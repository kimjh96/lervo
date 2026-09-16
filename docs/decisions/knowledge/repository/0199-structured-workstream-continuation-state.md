# ADR-0199: Structured workstream continuation state

- Status: accepted (amended 2026-08-24)
- Decision date: 2026-08-24

## Context

Lervo previously exempted root `HANDOFF.md` from semantic routing and used it as a short continuation entrypoint. Reviewed normalization could move history into `docs/repository/handoffs/`, but the mutable root file mixed objectives, actions, deployment facts, references, and durable documentation. Its line limit supplied no workstream identity, revision transitions, event binding, automatic provider context, reliable cross-device coordinates, or lifecycle.

`HANDOFF.md` is not a standard Codex or Claude discovery surface; neither its name nor location is a portable repository contract. Existing projects may use session notes, status pages, work logs, issue documents, or arbitrary Markdown for active state. New projects may have none.

## Decision

Active continuation state uses the provider-neutral `lervo.workstream.v1` snapshot contract. The local projection is written lazily to `.lervo/state/workstreams/current.json`; no workstream directory exists before the first snapshot. Each snapshot contains:

- A stable workstream ID and monotonic revision.
- An `active`, `blocked`, `completed`, or `cancelled` status. Cancellation records a stop request; [supervision cancellation reconciliation](../../../specifications/execution/outcome-supervision/implementation/recovery/cancellation.md) separately proves scoped effects are reconciled and requires upgraded transport readers.
- Bounded title, objective, next actions, blockers, current facts, unresolved decisions, and approvals.
- Repository-relative references, immutable origin coordinates, and update time.

Unresolved decisions and approvals retain choices or exact binding coordinates needed by the next agent, without accumulating resolved history. The working agent resolves natural-language user responses. Resolved items leave current state; durable outcomes move to canonical documentation.

Every committed snapshot is stored byte-for-byte in local CAS and emits `workstream.snapshot.recorded`. The event contains workstream ID, revision, status, change kind, current and previous snapshot hashes, content-addressed artifact coordinates, optional legacy-source artifact coordinates, and time. It excludes objective, action, blocker, note, reference text, absolute path, provider text, prompt, credential, and source body. Missing events, mismatched projections, or missing or invalid current snapshot artifacts invalidate workstream context and fail terminal completion closed. Legacy HANDOFF migration retains the source artifact locally.

`lervo workstream current` reads verified current state; `--context` returns bounded agent context, and `--json` returns the structured snapshot. `lervo workstream start` accepts bounded semantic fields, derives system identity and created origin, and uses reproducible plan/apply. It supports recovery and inspection; provider integration instructs the working agent, rather than the user, to invoke it. `lervo workstream update` accepts a complete v1 JSON snapshot, creates a read-only plan, requires its exact plan ID for apply, preserves workstream identity and origin, and requires the revision to increase by exactly one.

After a settled `completed` or `cancelled` head with no blockers or pending decisions or approvals, `lervo workstream start` may create a new workstream ID and revision 1 in the same repository. The new `successor` origin records only the predecessor workstream ID and exact snapshot hash. Its `workstream.snapshot.recorded` event links that hash as `previousSnapshotContentHash`. The current projection is atomically replaced; the predecessor event and CAS artifact remain intact. An active, blocked, cancelled, or unsettled head cannot be replaced. The start plan binds the exact predecessor hash; a changed head requires replanning. This creates a new goal and request-binding scope, not a revision or amendment of the completed goal.

Managed runs add a present current workstream as a required `repository.workstream` context candidate with ordinary E1 selection, E2 exact-byte loading, and provider-adapter E3 delivery. Direct Codex and Claude hooks prepend at most 8 KiB of verified workstream context and record workstream ID, revision, exact snapshot hash, delivered byte count, full or prefix scope, and repository revision prepared for the turn. An unchanged turn creates no artificial continuation history. When repository-authored bytes change, Stop requires a first snapshot if none existed at prompt preparation, or a revision greater than the prepared revision. Before completion, the working agent records `agent_start` or `agent_update` with its provider coordinate. Unmanaged preparation proves neither provider acceptance nor use.

`lervo migrate knowledge` safely scans included Markdown throughout the repository before layout work. It ranks continuation candidates using bounded name, title, objective, next-action, blocker, current-state, and active-language signals; path and basename alone never suffice. One unambiguous candidate may be planned automatically. Multiple candidates block until an exact `--continuation-source` is supplied. Lervo never heuristically merges candidate prose.

Exact-approved apply preserves source bytes in CAS, creates the current projection, and updates resolvable Markdown references to `lervo workstream current`. Only the dedicated root legacy `HANDOFF.md` is deleted with its source-owned normalization records. Arbitrary sources may mix active and durable knowledge, so their user bytes remain for reviewed normalization and splitting. One content-bound approval covers every state and user-byte change. Event or validation failure restores every changed file. With no candidate, the first working agent creates the snapshot during its turn. Structural refresh and reviewed normalization use the same content-aware continuation profile for lasting history documents regardless of name or location.

Durable architecture, product, operational, and decision facts must move to appropriate canonical Markdown. Completed handoff publications may remain under semantically grouped documentation only when durably valuable; they are not active continuation state.

Hub event synchronization does not transfer workstream bodies. The separately authorized repository-scoped replication contract in [ADR-0201](../../coordination/sync/0201-repository-scoped-workstream-replication.md) publishes bounded snapshot revisions and may materialize a newer unique head on another authorized node. Local use never depends on that transport.

## Failure meaning

- Invalid or conflicting current state blocks import or update; Lervo does not replace a different active workstream.
- A successor whose origin does not exactly identify a settled completed or cancelled predecessor fails validation or replication. Distinct unlinked roots remain divergent rather than silently replacing a completed goal.
- A stale plan means the source, reference, lifecycle record, current state, or desired snapshot changed and requires replanning.
- Missing exact approval leaves the selected continuation source and every reference untouched.
- Multiple credible sources remain separate and block automatic migration; Lervo does not infer a merge.
- A repository-changing direct terminal turn cannot complete without creating or advancing its verified checkpoint; an unchanged turn does not advance it.
- Pre-event apply failure rolls back source, state, references, and lifecycle records.
- Committed-event cleanup failure preserves the committed snapshot and requires normal durable recovery.
- Missing provider telemetry never upgrades workstream preparation into acceptance or use.

## Consequences

Repository roots retain only conventional human and provider entrypoints. Workstream state becomes bounded, revisioned, inspectable, and provider-neutral without assuming a legacy filename or location. Legacy source bytes remain locally recoverable without forcing session history into durable documentation. Managed and unmanaged execution receive the same state with distinct evidence semantics.

The current-state projection remains local node state in v1 and is not published through Git. With explicit Hub replication, only the bounded snapshot contract crosses authorized repository nodes; prompts, transcripts, credentials, legacy source bodies, and approval authority do not. [ADR-0200](../../execution/providers/0200-natural-language-terminal-turn-finalization.md) defines changed-turn declarations and conditional checkpoint enforcement. [ADR-0201](../../coordination/sync/0201-repository-scoped-workstream-replication.md) defines cross-node transport and divergence handling.

## Superseded clauses

This decision supersedes ADR-0193 where it listed root HANDOFF as a permanent entrypoint and ADR-0195 where it retained root HANDOFF as the active continuation document. Nested historical HANDOFF, SESSION, or CONTEXT documents may still use the reviewed handoff-document format when they are durable repository documentation rather than active state.

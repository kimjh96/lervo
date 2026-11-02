# ADR-0218: Content-bound provider-entrypoint bootstrap

- Status: accepted
- Decision date: 2026-08-25
- Amended by: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (independent cross-check replaces the operation approval)

> **Amended (2026-11-02).** Under [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), the adoption plan no longer takes an operation approval. The background lifecycle reviewer, or a foreground independent cross-check before `--apply`, must agree; the adoption then lands as its own `Lervo Knowledge` commit that `lervo knowledge revert <commit>` undoes.

## Context

A repository can begin with user-owned `CLAUDE.md` instructions and no `AGENTS.md`. Structural migration previously created a generic AGENTS entrypoint, then appended a managed import to CLAUDE. Although byte-preserving, this did not adopt the shared instructions as canonical and duplicated policy across both files. Coupling the correction to unrelated document normalization also allowed an unrelated review decision to block provider discovery.

## Decision

Canonical instruction bootstrap is a dedicated content-bound stage that precedes repository layout, structural publication, provider-bridge convergence, terminal integration, and reviewed normalization.

`instruction_canonical_bootstrap` classifies exact current bytes as `not_applicable`, `review_required`, or `blocked`. A present safe AGENTS file completes bootstrap whether it is user-owned or a recorded Lervo generation. If AGENTS is absent and CLAUDE is a safe included instruction containing neither a provider import nor a managed block, the stage proposes AGENTS as the exact CLAUDE bytes followed by one separately rendered `repository_instruction_routes` managed block. The plan binds the repository snapshot, policy, source hash, canonical output hash, operation, and approval. CLAUDE remains byte-identical. A source already mixing imports or managed blocks is `unresolved_mixed` and fails closed rather than guessing ownership.

Applying adoption requires the exact `kinstbootop` ID and approval hash. The durable knowledge journal atomically publishes AGENTS and records `knowledge.materialization.applied` with `operation=instruction_canonical_adoption`. Event failure restores the missing target; interruption leaves the ordinary recoverable journal. Events exclude paths and document bodies. A local receipt may report source and canonical hashes without claiming semantic equivalence.

Provider bridge planning uses exact construction equality, not similar prose or provider output. If appending the current canonical route block to unchanged CLAUDE bytes exactly reconstructs AGENTS, CLAUDE is `exact_adopted_duplicate` and may be replaced with the thin managed `@AGENTS.md` bridge under a separate exact approval. Otherwise, an unmanaged CLAUDE body is `unresolved_mixed_user_content`; the update preserves every existing byte and appends one managed import. An existing valid managed import is `managed_bridge`. Replanning never adds a second import.

The migration command, repository upgrade inspection, knowledge refresh, and terminal status expose the same bootstrap state and failure meaning. Canonical-adoption approval never authorizes a CLAUDE rewrite. Bridge approval never authorizes README, changelog, architecture, skill, or normalization changes. Generated structural and navigation stages remain separately plan-bound.

Gemini, Copilot, subtree bridges, semantic provider-content classification, and provider settings are outside this decision.

## Consequences

Claude-only repositories can converge to one provider-neutral canonical source and one thin provider adapter without manual copying. Mixed provider content remains byte-safe. Exact source changes stale only their bound stage, and unrelated normalization review cannot block an already reviewed canonical or bridge disposition.

Bootstrap adds an explicit approval before structural migration when existing Claude-only instructions become canonical. This is required because creating AGENTS grants those bytes provider-neutral discovery authority.

## Failure meaning

- `review_required`: Safe Claude-only bytes require exact approval before becoming canonical.
- `blocked`: Ownership boundaries are mixed or a source or target cannot be read safely; no bytes change.
- `knowledge_plan_stale`: The source, target, routes, policy, or repository snapshot changed; replan.
- `knowledge_approval_required`: The operation ID or approval hash is missing or differs.
- `knowledge_apply_failed`: Publication or event recording failed before commit, and bytes were restored.
- `knowledge_recovery_required`: An interrupted durable transaction must be recovered before another mutation.

## Superseded clauses

This decision amends ADR-0185, where an existing unmanaged CLAUDE target was only an append target. An exact adopted duplicate may instead be reduced to the thin bridge under an independent exact approval. All other unmanaged bytes remain preserved.

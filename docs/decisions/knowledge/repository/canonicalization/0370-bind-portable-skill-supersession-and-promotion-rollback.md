# ADR-0370: Bind portable-skill supersession and promotion rollback

Status: `accepted`  
Date: 2026-09-05

## Context

The installed portable-skill journey proved the successful path, while stale-source rejection and four-file rollback remained unit-level implications of the generic promotion engine. Review allowed `supersede` only from candidate or deferred states, preventing reviewed or promoted patterns from naming an exact successor. Transition events also omitted the replacement coordinate from their privacy-bounded projection.

## Decision

Move development-pattern review transitions into a provider-neutral lifecycle module. Candidate and deferred patterns retain existing review decisions. Reviewed and promoted patterns permit only `supersede`. The replacement must be a distinct current candidate, reviewed, or promoted pattern owning the same exact target kind and path. The review CAS remains immutable.

Add optional `supersededByPatternId` to `development.pattern.transitioned` and its privacy allowlist. New supersession events retain this bounded pattern coordinate, and the current projection exposes it. Historical events without it remain valid. Events continue to exclude candidate bodies, target paths, reviewer identity, source text, and provider output.

Supersession changes lifecycle evidence only. It does not rewrite or delete an already promoted target, revoke project authorization, change an installed immutable capability package, or alter a capability lock. Those effects require their own exact authority boundary.

Retain promotion rollback in the durable materialization transaction. Instructions, resources, and both manifests publish as one exact unit. If transition recording fails, every created package file is removed and no success event remains. A differing existing target blocks the plan before apply and preserves all existing bytes.

The packed journey must accept a candidate, change a bound source, observe `source_snapshot_changed`, create a current replacement, supersede the stale reviewed candidate by exact pattern ID, then review and promote the replacement before authorization and execution.

## Consequences

Stale evidence can be retired without losing provenance. Callers can discover its exact successor from bounded events and reconstructed status. Promotion failure cannot expose a partial four-file package. Supersession remains separate from filesystem replacement and execution revocation.

## Verification

- Pure lifecycle tests cover allowed review paths, terminal-state rejection, distinct replacement identity, current replacement state, and exact target responsibility.
- Promotion tests inject finalization failure and verify that all four package files are absent afterward; a conflicting maintainer-owned target remains byte-identical.
- Event privacy tests verify that the replacement pattern ID survives sanitization without admitting unbounded fields.
- The packed CLI journey proves installed stale-source rejection, exact supersession, replacement promotion, authorization, dependency migration, and managed completion.

## References

- [Repository development-pattern lifecycle](../../../../specs/repository-development-pattern-lifecycle.md)
- [Evidence-bound development-pattern promotion](../0220-evidence-bound-development-pattern-promotion.md)
- [Portable-skill candidates from verified workflows](0368-create-portable-skill-candidates-from-verified-workflows.md)
- [Portable-skill project authorization](../../../execution/orchestration/0369-authorize-promoted-portable-skills-for-project-execution.md)

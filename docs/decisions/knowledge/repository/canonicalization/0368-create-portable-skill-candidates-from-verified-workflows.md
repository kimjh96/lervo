# ADR-0368: Create portable-skill candidates from verified workflows

Status: `accepted`  
Date: 2026-09-05

## Context

Development-pattern review could promote one `SKILL.md`; capability migration could package an existing loose skill. Neither established a repeatable workflow in a completed repository result, bound independent verification to each occurrence, or exposed resources and execution contracts for one exact review. Treating retrieved sources, provider agreement, or repeated syntax as candidacy would invent evidence and authority.

## Decision

Add an evidence-bound portable-skill specialization to the provider-neutral development-pattern contract. Require at least two independent occurrence groups. Each group binds one distinct current passed `verification.completed` event and run, including event, suite, repository-revision, and result-content hashes. Each occurrence also binds its current source and unit hashes. Missing, failed, duplicated, or changed verification blocks candidacy and promotion.

The candidate contains bounded `SKILL.md` and resource bytes plus reviewed input, output, tool, permission, platform, provider, role, and resource contracts. Lervo deterministically derives a content-hash-bound `lervo-skill.json`. Initial trust is untrusted and enabled scope is disabled: pattern review and materialization grant neither capability selection nor activation.

A direct terminal completion may use the typed `portable_skill_candidate` canonicalization outcome. It must bind every changed noncanonical source exactly once, fit the existing declaration bound, and pass current source and canonical verification checks. Finalization stores the candidate body in owner-only CAS and records only existing privacy-bounded development-pattern events, without duplicating ordinary canonicalization candidate state. The terminal declaration and initial pattern transitions commit atomically. Failure before commit leaves at most an unreferenced CAS object; a rebuildable-projection failure preserves canonical events for recovery.

Promotion remains a separate exact plan/apply transaction. It treats instructions, resources, and the skill manifest as one rollback unit, rechecks verification evidence and source freshness, blocks conflicting target bytes, and exposes no proposed body in its public plan. Capability migration, trust review, selection, activation, invocation, effect observation, supersession, and rollback remain separate authorities and evidence states.

## Consequences

A completed result can create a reviewable portable-skill candidate without broad source-to-skill generation. Repository knowledge, capability packaging, and provider adapters remain replaceable boundaries. Installed review-through-invocation and post-promotion-effect acceptance remain required to complete the broader product outcome.

## Verification

- Pure tests cover independent source and verification hashes, duplicated runs, changed evidence, bounded resources, disabled manifests, and multi-file promotion plans.
- Terminal integration records a candidate only after two current passed verification results and one changed result source are bound through finalization.
- Existing provider-neutral development-pattern review and promotion regression remains green.
- Quality, type, documentation, knowledge lifecycle, and task-base release-completion checks pass.

## References

- [Repository development-pattern lifecycle](../../../../specs/repository-development-pattern-lifecycle.md)
- [Repository knowledge lifecycle convergence](../../../../specs/repository-knowledge-lifecycle-convergence.md)
- [Capability packages](../../../../specifications/execution/capabilities.md)
- [Product outcome convergence](../../../../roadmap/product-outcome-convergence/repository-knowledge.md)

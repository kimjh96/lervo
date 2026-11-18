---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.orchestration
---

# ADR-0377: Install evidence-bound agent-profile candidates

Status: `historical`
Decision date: 2026-09-06

Amended by: [ADR-0533](../../knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The development-pattern pipeline is historical and its commands are removed.

## Context

Repository roles had strict versioned sources and runtime resolution. Development patterns had immutable candidates, exact review, supersession, promotion, and effect observation. No installed route connected repeated verified role use to a reviewable profile change. Separate profile memory or provider-specific learning would duplicate lifecycle authority and weaken the distinction between observed use and approved configuration.

## Decision

Extend the development-pattern target union with `agent_profile`, exposed through `lervo role candidate`. Eligibility requires at least two independent managed runs, each with an exact schema-v2 `role.profile.activated` event and a passed `verification.completed` event from that same run. All activation evidence binds one role ID, version, role-contract hash, and effective-profile hash.

New profiles specialize the exact source role version. Replacements retain the role ID, advance its version, and bind the exact current target hash. Review binds exact candidate bytes. Before writing one user-owned deterministic role JSON file, activation rechecks current source units, activation and verification events, source role resolution, and target bytes. Supersession reuses the existing same-target lifecycle relation.

Promotion retains exact predecessor bytes in owner-only CAS. Explicit rollback deletes a newly created profile or restores those bytes only when the promoted target remains exact, then verifies role resolution before committing `rolled_back`. The existing improvement-effect lifecycle owns baseline and treatment comparison; attribution remains `unestablished`, and it grants no rollback authority.

Roles owns role-source validation and rendering; repository knowledge owns evidence and transition decisions; the CLI owns collection and orchestration. Provider adapters remain unchanged, preserving local execution without Hub and provider neutrality.

## Event, privacy, and failure meaning

Add schema-v2 `role.profile.activated` with activation ID, provider, role ID and version, role-contract hash, effective profile hash, runtime-profile hash, source kind, and activation time. Repositories selecting writer v1 continue managed execution without this evidence; those runs are ineligible for profile candidacy.

The event excludes prompts, profile text, paths, provider output, credentials, native session IDs, repository content, and user identity. It proves only that the managed provider/verification phase used exact resolved role coordinates. It does not prove model attention, semantic use, quality, publication, or run completion.

Extend `development.pattern.transitioned` with target `agent_profile`, state `rolled_back`, optional predecessor artifact/content hashes, and optional activated role coordinates. No success transition is recorded for invalid evidence, stale source roles, changed target bytes, wrong approvals, missing or changed predecessor artifacts, failed role resolution, storage failure, or event failure. Durable apply restores modified bytes when its completion callback fails.

## Verification

- Domain tests reject changed activation evidence and prove exact create/delete and replacement/restore rollback.
- CLI tests prove exact review, activation, baseline registration, favorable observation with unestablished attribution, rollback, and projection rebuilding.
- Managed-run adapter tests prove Codex and Claude emit the provider-neutral activation contract.
- The packed consumer creates a candidate from real installed managed-run evidence, activates and resolves the role, and rolls the profile back.

## References

- [Versioned repository role contracts](0209-versioned-repository-role-contracts.md)
- [Evidence-bound agent-profile candidates](../../../specifications/execution/authority-and-repository/agent-profile-candidates.md)
- [Repository development-pattern lifecycle](../../../specs/repository-development-pattern-lifecycle.md)
- Verified improvement effects specification, removed by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)

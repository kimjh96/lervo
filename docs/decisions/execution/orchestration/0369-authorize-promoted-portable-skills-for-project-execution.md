# ADR-0369: Authorize promoted portable skills for project execution

Status: `accepted`  
Date: 2026-09-05

## Context

Portable-skill candidacy and promotion produced reviewed instructions, resources, and an untrusted, disabled skill manifest. Capability migration could package those bytes, but no lifecycle granted the exact trust and project scope required for selection. Migration also synthesized an empty dependency list, so a promoted candidate could not retain an exact MCP or plugin dependency and reach provider-confirmed activation without manually authored package metadata.

## Decision

Derive both `lervo-skill.json` and `lervo-capability.json` in the portable-skill candidate. The capability contract binds a separately named capability ID, compatibility, permissions, optional discovery metadata, and dependency IDs, versions, and content hashes. Promotion treats both manifests, `SKILL.md`, and reviewed resources as one rollback unit. Capability migration preserves a valid promoted capability contract only after project authorization; loose skills without one retain the existing synthesized-package behavior.

Add `lervo capability authorize-skill` as a separate exact plan/apply boundary. Planning accepts only a project skill published by `lervo.development-pattern` whose trust is `untrusted` and whose enabled scope is `disabled`. The plan binds repository and project identity, skill ID and version, content hash, manifest path, current and desired manifest hashes, reviewer and review time, and the exact trust and scope transitions. Apply requires the plan ID, revalidates the plan, manifest, and package content, and atomically replaces only `lervo-skill.json`. It changes trust to `reviewed` and scope to the current project; it cannot create a verified signature, change executable content, broaden scope, install dependencies, select the skill, or activate a provider.

The existing skill manifest is the canonical authorization record. Plans are caller-retained review inputs and receipts are bounded command output; this change adds no event. They contain repository paths, project and reviewer identifiers, timestamps, hashes, and transition names, but no skill body, resource body, request text, credentials, provider configuration, or user document content. Invalid coordinates fail as `skill_authorization_invalid`, an ineligible source or state as `skill_authorization_not_candidate`, changed reviewed bytes as `skill_authorization_stale`, and an unsuccessful atomic replacement as `skill_authorization_write_failed`. Every failure prevents capability migration from making the candidate executable under the requested project authority. Migration and immutable installation bind a separate whole-package hash so manifest-only changes cannot reuse an approved plan or an occupied version coordinate; the executable content hash retains its existing manifest-excluding meaning.

Runtime compatibility uses the installed CLI version rather than a historical internal package version. This keeps `minimumRuntimeVersion` meaningful for a generated skill without coupling the skill domain to CLI package loading.

## Consequences

Review, materialization, execution authorization, migration, selection, dependency activation, invocation, and completion remain distinct evidence boundaries. A promoted candidate can now retain exact dependency coordinates through installation and reach the existing provider-confirmed activation path. Existing loose-skill migration remains compatible, and provider behavior stays behind adapters.

The first installed journey proves the happy path only. Stale-source handling, supersession, rollback, and observable post-promotion effects remain separate acceptance work.

## Verification

- Pure and filesystem tests cover exact planning, project-scoped trust review, idempotent replay, stale manifests, and stale content.
- Capability tests cover preservation of a promoted capability manifest and exact dependencies while retaining loose-skill migration.
- CLI tests cover plan persistence and exact apply through `authorize-skill`.
- The packed-consumer journey performs two independent verified workflows, candidate proposal, exact review, four-file promotion, project authorization, migration, explicit selection, provider-confirmed MCP activation, invocation, repository verification, and digest-bound completion.

## References

- [Portable-skill candidates from verified workflows](../../knowledge/repository/canonicalization/0368-create-portable-skill-candidates-from-verified-workflows.md)
- [Repository development-pattern lifecycle](../../../specs/repository-development-pattern-lifecycle.md)
- [Repository capability migration](../../../specifications/execution/capabilities/repository-migration.md)
- [Installed natural-language capability journey](../../../evidence/foundation/installed-natural-language-capability-journey-v1.md)

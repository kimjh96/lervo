# Evidence-bound agent-profile candidates

Status: `historical`
As of: 2026-09-06


Amended by: [ADR-0533](../../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The following describes the removed implementation, not current commands.

## Purpose and ownership

`lervo role candidate` converts repeated, verified use of one exact role contract into a reviewable repository-role proposal. It does not learn a hidden provider profile, modify a built-in role, or infer a whole request. Repository role JSON remains user-owned canonical configuration. Candidate and review bodies are immutable local CAS artifacts. The event store owns lifecycle history; the current JSON view is rebuildable.

The roles package owns strict repository-role parsing, composition, hashing, and deterministic rendering. Repository knowledge owns candidate evidence, exact-current target decisions, promotion, replacement, and rollback. The CLI collects events and composes these contracts. Provider adapters remain unaware of the candidate lifecycle.

## Evidence and proposal

A candidate requires two to 64 independent source groups. Each binds a distinct completed managed run through both:

- One exact `role.profile.activated` event identifying provider, role ID and version, role-contract hash, effective profile hash, and runtime-profile hash.
- One exact passed `verification.completed` event from the same run, including suite, repository-revision, and result-content hashes.

All activation evidence must name the same exact source role contract. Occurrences bind current source units. A new role must extend that source role at its exact version. A replacement must retain the role ID, declare a different version, and bind the exact current target hash. Target bytes must be deterministic, bounded repository-role JSON at `.lervo/roles/<role-id>.json`.

Selection, activation, completion, verification, candidacy, review, materialization, effect observation, supersession, and rollback remain separate. Repetition establishes eligibility only.

## Review, activation, supersession, and rollback

`role candidate review` requires the exact candidate hash and a reviewer ID. `role candidate activate` uses the existing development-pattern promotion transaction through a profile-specific route. Before creating or replacing one user-owned role file, it rechecks source units, every activation and verification coordinate, the current source role, and expected target bytes. It records the resolved activated role ID, version, contract hash, and profile hash only after the exact file resolves.

Promotion captures a replaced predecessor's exact bytes in owner-only CAS. `role candidate rollback` accepts only the exact current promoted bytes and exact plan ID. It deletes a newly created profile or restores the captured predecessor, then revalidates role resolution before recording `rolled_back`. Changed targets, missing or changed predecessor artifacts, stale evidence, stale source roles, or wrong approvals fail closed without a success transition.

Only a distinct current candidate for the same target kind and path may supersede a reviewed or promoted profile candidate. Supersession changes lifecycle evidence without writing role bytes. Rollback is always explicit; effect observations never invoke it.

## Effect boundary

The existing `knowledge pattern effect register|observe` lifecycle applies without a profile-specific metric shortcut. Baseline registration occurs while the candidate is reviewed. Treatment begins after exact promotion and requires the same target hash, adapter, and metric set. Attribution remains `unestablished`; `review_required` grants no rollback authority.

## Privacy and failure meaning

`role.profile.activated` is schema-v2-only. A repository whose selected event writer remains v1 continues its managed run without this event and cannot use that run as candidate evidence. The payload contains activation ID, provider, role ID and version, role-contract hash, effective profile hash, runtime-profile hash, source kind, and activation time. It excludes prompts, role description and instructions, paths, provider output, credentials, native session IDs, repository content, and user identity.

The event means the managed provider/verification phase returned using the exact resolved role and runtime profile. It does not prove model attention, understanding, semantic reliance, quality, or whole-run publication success. Provider failure or event append failure yields no activation success; append failure fails the managed command.

`development.pattern.transitioned` additionally permits target kind `agent_profile`, state `rolled_back`, predecessor artifact and content hashes, and activated role coordinates. These fields exclude role bytes and target paths. Promotion or rollback records no transition unless its file transaction and role-resolution check succeed. Event failure restores changed bytes.

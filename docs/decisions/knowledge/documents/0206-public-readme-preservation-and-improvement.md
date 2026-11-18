# ADR-0206: Public README preservation and separate improvement

- Status: accepted
- Decision date: 2026-08-25

Partially superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the improvement part is removed. Lervo no longer ships the `public_readme_en_v1` improvement plan, its apply path, or `lervo readme propose`. Byte preservation, exclusion from required normalization, and the protected-coordinate inventory used by freshness checks stay.

## Context

The root README is usually a public product surface. Required normalization could expose internal agent operations or damage branding even if later approval prevented an automatic write.

## Decision

An existing root `README.md` remains user-owned and byte-preserved by default. It is excluded from required normalization, needs no AGENTS or Lervo route, remains available to repository scanning and context selection, and cannot make onboarding or terminal lifecycle stale merely because it lacks a reviewed rewrite.

Optional improvement uses a separate `public_readme_en_v1` content-bound plan. It declares audience and intent, retains one root entrypoint, and inventories protected HTML blocks, images, badges, link targets, anchors, fenced commands, package names, installation commands, version requirements, license/security/sponsor links, tables, and accessibility text. Each added or removed protected coordinate receives a stable change ID and requires individual approval plus the exact whole-file operation ID and hash. A missing README cannot cause candidates to invent external, badge, installation, or package coordinates. Internal `.lervo`, AGENTS, provider-hook, terminal, or workstream bookkeeping is rejected.

Apply records source and output hashes, profile and language, audience and intent digests, protected-coordinate digest and counts, approval hash, and time. It excludes README bodies, raw coordinates, paths, prompts, reviewer identity, and credentials. Failure restores README and lifecycle state and records no success.

## Consequences

Repository readiness does not pressure owners to rewrite public onboarding. Explicit improvement remains reviewable and auditable without weakening default preservation.

## References

- [Existing document adoption](0018-existing-document-adoption.md)
- [Reviewed document normalization](../repository/0195-reviewed-document-content-normalization.md)
- [Public README roadmap](../../../roadmap/knowledge/public-readme-migration.md)

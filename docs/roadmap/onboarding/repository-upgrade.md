# Repository upgrade orchestration

Status: `complete`
Completed: 2026-08-25

## Outcome

After installing the intended CLI release, an agent can inspect and apply an existing repository's Lervo upgrade through `lervo upgrade`. One content-bound plan coordinates capability migration, generated-only knowledge convergence, lint, terminal-runtime refresh, and transactional payload reconciliation for a registered repository Node.

## Completion criteria

- Planning is read-only and binds the physical repository, project, CLI build, and exact current inner plans.
- Apply rejects stale approval, permits only generated or Lervo-owned automatic changes, and stops at user-owned or provider-owned authority.
- Loose skills migrate before knowledge, and generated AGENTS routes include portable skills on first materialization.
- Registered Node services compare content-addressed payload identity, not semantic version alone, and reuse existing owner-only configuration without exposing it.
- Same-version rebuilt Node payloads upgrade transactionally; complete readiness or three fresh Hub-unavailable-only `offline_ready` observations are required before the fleet registry commits.
- Knowledge lint succeeds after every applied repository upgrade.
- The local-only path works without a Hub; absent Node registration is current rather than an onboarding side effect.
- CLI acquisition remains an explicit installation-environment responsibility and is never misreported as repository-upgrade evidence.

## Evidence

- [ADR-0214](../../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md)
- `apps/cli/test/upgrade-command.test.ts`
- `apps/cli/test/upgrade-node.test.ts`
- `apps/cli/test/repository-command.test.ts`
- `packages/repository-knowledge/test/repository-layout-migration.test.ts`
- `scripts/test/runtime-service-management.test.mjs`

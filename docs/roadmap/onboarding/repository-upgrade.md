# Repository upgrade orchestration

Status: `complete`
Completed: 2026-08-25

## Outcome

After installing the intended CLI release, an agent can inspect and apply an existing repository's Lervo upgrade with `lervo upgrade`. One content-bound plan coordinates capability migration, generated-only knowledge convergence, lint, terminal-runtime refresh, and transactional payload reconciliation for a registered repository Node.

## Completion criteria

- Planning is read-only and binds the physical repository, project, CLI build, and exact current inner plans.
- Apply rejects stale approval, permits only generated or Lervo-owned automatic changes, refreshes content-bound stale built-in workforce role bindings before Node reconciliation, and stops at user-owned or provider-owned authority.
- Built-in agent and assignment refreshes advance revisions and record canonical events. Repository-defined role drift exposes a content-bound per-role approval; only an exact `--approve-role-binding` value refreshes those records, and the user-owned role source remains unchanged.
- Loose skills migrate before knowledge. Generated AGENTS routes include portable skills on first materialization.
- Registered Node services compare content-addressed payload identity, not semantic version alone, and reuse existing owner-only configuration without exposing it.
- Same-version rebuilt Node payloads upgrade transactionally. Fleet registry commit requires complete readiness or three fresh Hub-unavailable-only `offline_ready` observations.
- Knowledge lint succeeds after every applied repository upgrade.
- The local-only path works without a Hub. Absent Node registration is current, not an onboarding side effect.
- A stale registered Node under a current sync-disabled project policy remains pending authority without blocking local generated-only migration.
- CLI acquisition remains an explicit installation-environment responsibility and is never reported as repository-upgrade evidence.

## Evidence

- [ADR-0214](../../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md)
- `apps/cli/test/upgrade-command.test.ts`
- `apps/cli/test/upgrade-node.test.ts`
- `apps/cli/test/repository-command.test.ts`
- `packages/repository-knowledge/test/repository-layout-migration.test.ts`
- `scripts/distribution/test/runtime-service-management.test.mjs`

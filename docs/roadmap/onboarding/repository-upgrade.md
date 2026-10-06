# Repository upgrade orchestration

Status: `complete`
Completed: 2026-08-25

## Outcome

After installing the intended CLI release, an agent can inspect and apply an existing repository's Lervo upgrade with `lervo upgrade`. One content-bound plan coordinates capability migration, generated-only knowledge convergence, lint, terminal-runtime refresh, and transactional payload reconciliation for a registered repository Node.

## Completion criteria

- Read-only planning binds the physical repository, project, CLI build, and exact current inner plans.
- Apply rejects stale approval, permits only generated or Lervo-owned automatic changes, refreshes content-bound stale built-in workforce role bindings before Node reconciliation, and stops at user-owned or provider-owned authority.
- Built-in agent and assignment refreshes advance revisions and record canonical events. Repository-defined role drift requires content-bound per-role approval: only an exact `--approve-role-binding` value refreshes those records; the user-owned role source stays unchanged.
- Loose skills migrate before knowledge. Generated AGENTS routes include portable skills on first materialization.
- Registered Node services compare content-addressed payload identity, not semantic version alone, and reuse existing owner-only configuration without exposing it.
- Same-version rebuilt Node payloads upgrade transactionally. Fleet registry commit requires complete readiness or three fresh Hub-unavailable-only `offline_ready` observations.
- A replacement accepts a non-delivery condition only when it is unchanged from the predecessor's baseline, such as supervision attention that awaits an owner decision. The receipt lists it in `carriedConditions`. The readiness window extends with startup progress up to 600 seconds. A timeout names the blocking component, and a failed recovery keeps that detail. An exact deployment with only such conditions plans as `current/exact_runtime_deployed_runtime_attention` ([ADR-0475](../../decisions/operations/services/0475-judge-node-replacement-readiness-by-regression.md)).
- A Node publishes component readiness without waiting for cache warm-ups. The managed-conversation knowledge index builds after readiness settles. While `starting`, the Node refreshes `updatedAt` every five seconds, and readiness counts that heartbeat from the first starting process as progress, still bounded at 600 seconds ([ADR-0480](../../decisions/operations/services/0480-defer-node-cache-warmups-past-readiness.md)).
- An exact installed Node left inactive by a failed stop can resume a guarded upgrade from its prior matching work-admission scope only after stable inactivity and zero live claims. Graceful stop retains that scope, so re-applying after an interrupted launchd upgrade does not fail as `service_upgrade_fence_invalid`. Unregistered Nodes remain blocked.
- Knowledge lint succeeds after every applied repository upgrade.
- Background knowledge materialization owned by a running process delays planning and every knowledge step for at most 15 minutes instead of failing the upgrade. An expired wait names the owner. Only an interrupted marker fails at once with the recovery command ([ADR-0483](../../decisions/operations/services/0483-wait-for-live-knowledge-materialization-in-foreground-commands.md)).
- A blocked stage defers only its dependents under published `policy.stageDependencies`. Independent stages, including generated-only terminal runtime refresh, still apply; the plan remains `blocked` with the stage's exact blockers.
- The local-only path works without a Hub. Absent Node registration is current, not an onboarding side effect.
- A stale registered Node under a current sync-disabled project policy remains pending authority without blocking local generated-only migration.
- CLI acquisition remains an explicit installation-environment responsibility and is never reported as repository-upgrade evidence.
- An `event_writer` stage activates event schema 4 through the existing event-contract evidence, plan, and apply contract, after a recoverable backup. Local-only and Node-absent checkouts activate in the reviewed apply. Hub-enabled checkouts with a Node re-observe Node health and Hub capability, or report the exact blocker and remedy ([ADR-0470](../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)).
- A `host_service` stage installs, activates, or transactionally replaces the one host resident service (launchd or systemd user) when a registered checkout without a Node needs a resident. It never duplicates a Node's resident.
- A `replica_service` stage, last and after `node`, points the host's `current` Node runtime pointer at the bundled runtime and, when `repository-replica-coordinator.json` sits in the user state directory, migrates a legacy `~/.lervo/repository-replica-coordinator.json` there with a backup, and installs or replaces the `dev.lervo.repository-replica` (launchd) or `lervo-repository-replica.service` (systemd) coordinator service that runs through that pointer ([ADR-0483](../../decisions/coordination/sync/0483-run-replica-commands-through-one-current-runtime.md)).

## Evidence

- [ADR-0214](../../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md)
- [ADR-0475](../../decisions/operations/services/0475-judge-node-replacement-readiness-by-regression.md)
- [ADR-0480](../../decisions/operations/services/0480-defer-node-cache-warmups-past-readiness.md)
- [ADR-0483](../../decisions/operations/services/0483-wait-for-live-knowledge-materialization-in-foreground-commands.md)
- `apps/node-runtime/test/conversation-read-responder-startup.test.ts`
- `apps/node-runtime/test/startup-deferred-work.test.ts`
- `apps/cli/test/node-fleet-readiness.test.ts`
- `apps/cli/test/node-fleet-readiness-policy.test.ts`
- `apps/cli/test/upgrade-command.test.ts`
- `apps/cli/test/upgrade-knowledge-materialization-wait.test.ts`
- `apps/cli/test/upgrade-node.test.ts`
- `apps/cli/test/upgrade-independent-stages.test.ts`
- `apps/cli/test/upgrade-stage-policy.test.ts`
- `apps/cli/test/event-writer-activation-stage.test.ts`
- `apps/cli/test/knowledge-host-service.test.ts`
- `apps/cli/test/upgrade-event-writer-host-service.test.ts`
- `apps/cli/test/repository-command.test.ts`
- `packages/repository-knowledge/test/repository-layout-migration.test.ts`
- `packages/repository-knowledge/test/materialization-settlement.test.ts`
- `scripts/distribution/test/runtime-service-management.test.mjs`

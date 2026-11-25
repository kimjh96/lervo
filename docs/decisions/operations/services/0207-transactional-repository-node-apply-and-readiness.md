# ADR-0207: Transactional repository Node apply and readiness

- Status: accepted
- Decision date: 2026-08-25
- Amended by: [ADR-0489](0489-migrate-node-configurations-only-inside-the-service-transition.md)

## Current replacement-readiness amendments

[ADR-0475](0475-judge-node-replacement-readiness-by-regression.md) amends replacement and rollback readiness: a fresh predecessor baseline may carry unchanged unavailable non-delivery conditions, receipts expose them, and failures retain bounded readiness and recovery details. Delivery-component failures are never carried over. First onboarding still requires complete readiness.

[ADR-0480](0480-defer-node-cache-warmups-past-readiness.md) adds advancing starting heartbeats from the first process identity seen starting to observation progress. It supersedes the original fixed sixty-second window with sixty seconds after qualifying progress, bounded at 600 seconds. A later starting process identity ends heartbeat-based extensions. See [bounded offline replacement](../../../specifications/coordination/hub-and-node/runtime-lifecycle/bounded-offline-replacement.md) for the current operational summary. These amendments do not establish installed verification success.

## Context

The fleet registry and read-only onboarding plan did not install the shipped runtime, activate a repository-scoped service, prove application readiness, or upgrade an instance. Service files and registry coordinates alone do not establish a working Node.

## Decision

### Apply authority and launcher

The installed CLI ships an executable `lervo-node` bundle beside `lervo`. `lervo repository node apply` requires the exact current onboarding plan ID, owner-only Node config, and explicit write authority. Before mutation, it revalidates the plan, physical repository root, Hub destination, optional remote-control Node identity, executable, expected service-target hash, and absence of an unresolved legacy singleton. Config and service bodies remain outside the plan and output.

The launcher binds an absolute Node executable and a content-addressed, self-contained runtime bundle, avoiding dependence on interactive-shell `PATH` or a source checkout. An explicitly authorized legacy transition installs and proves the repository service, commits fleet registration, then stops and archives the exact verified singleton definition.

### Installation and readiness

New installations use the canonical release-tested systemd or launchd definition. For three observations, the manager must report installed, enabled where applicable, and active. Lervo then requires three consecutive owner-only runtime-health observations from one process identity, all no older than the apply attempt. Event sync and workstream replication must be `ready`; remote control must be `ready` or `disabled`. Fleet registration commits only after these checks pass.

A registered repository upgrade may accept `offline_ready` after the same three fresh, monotonic observations if every non-ready required component reports exactly `hub_unavailable`. The original observation window was sixty seconds to let sequential transport deadlines settle before rollback; the amendments above supersede that window. This proves that the replacement process and retry loop run while the optional Hub is unreachable. It does not prove synchronization, replication, remote control, or Hub readiness. Authentication, configuration, integrity, divergence, stale-health, mixed, and unknown failures remain rejected. First onboarding requires complete readiness and cannot use this exception.

### Replacement and recovery

Existing exact definitions are reused. Changed definitions use a content-hash-bound transactional upgrade: a stably operational predecessor is stopped before the exact replacement is atomically published and restarted. An exact installed but inactive predecessor is valid recovery input; it is replaced and activated without a destructive remove/install cycle.

On replacement failure, Lervo restores the predecessor's exact bytes and prior operational or inactive disposition. Runtime-readiness or fleet-registration failure removes a newly installed service or rolls back an upgraded service. If recovery cannot be proved, the operation fails as unknown rather than claiming success.

### Status

`lervo repository node status` reports every project and instance independently, separating manager availability, installation, activation, event sync, workstream replication, remote control, freshness, and one bounded recovery action. Aggregate readiness is degraded when any registered instance is not ready.

## Privacy and failure meaning

The apply receipt contains the plan ID, service transition, three-observation readiness coordinates, and secret-free registry result. Readiness `status` is `ready` or `offline_ready`. Required fields are observation count, process ID, process start time, and bounded sync, workstream-replication, and remote-control statuses. `offline_ready` components expose only `unavailable:hub_unavailable`, subject to the amendments above.

The receipt excludes bearer tokens, config bodies, service bodies, prompts, provider output, and reasoning.

`node_fleet_plan_stale`, configuration or identity errors, service conflicts, readiness timeout, registry failure, and recovery failure mean only that the named stage was not proved; none implies successful synchronization. `offline_ready` proves deployment continuity while Hub-dependent capability remains unavailable and retryable. A legacy singleton requires explicit transition and is never silently overwritten.

Apply preserves the service manager's bounded failure codes, including `service_upgrade_supervision_busy`, `service_upgrade_work_busy`, and `service_upgrade_fence_invalid`. Supervision and work fences first wait up to 15 minutes for a running cycle or admitted work to settle; a concurrent upgrade is refused immediately. These failures occur before a service stop and retain the installed definition and fleet registration. Failures without a typed service meaning use `node_fleet_apply_failed`.

## Consequences

Installed artifacts can create, reconcile, inspect, and transactionally upgrade independent repository Node services. Registry state commits after readiness; it is not an optimistic installation claim. External Hub registration and scoped credential issuance remain separate authority inputs.

## References

- [Repository Node fleet identity](0202-repository-node-fleet-identity-and-registry.md)
- [Read-only onboarding reconciliation](0203-read-only-repository-node-onboarding-reconciliation.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)

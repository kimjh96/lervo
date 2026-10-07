# Upgrade orchestration and guarded Node configuration changes

## Orchestration and authority

[ADR-0214](../../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md) retains exact identity and build binding, byte-preserved capability migration, exact role approvals, at most sixteen revalidated generated-only knowledge stages, lint, and transactional Node reconciliation. Stage dependencies include ADR-0470's event writer and independent host service, and ADR-0483's final replica service stage.

Blocked stages defer their dependents; independent applicable stages may still run. Provider configuration, user-owned documents, repository-role approval, credentials, legacy transitions, and publication retain separate authority boundaries. CLI acquisition remains outside the repository plan.

[ADR-0484](../../decisions/operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) places apply inside host full-cycle admission. [ADR-0487](../../decisions/operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) permits `--apply --safe` to plan inside that window, refuse any pending owner authority before effects, and otherwise apply generated-only safe stages.

Admission does not freeze user edits, replica changes, or other writers outside resident full cycles. Inner revalidation, marker settlement, and bounded scan retries remain required. Exact outer-plan refusal before apply means nothing was applied; a later stage failure does not undo or negate earlier successful stages.

## Current CLI pointer and configuration planning

[ADR-0488](../../decisions/operations/services/0488-point-node-configurations-at-one-current-cli.md) retains:

- A host-local absolute `runtimes/cli/current` link to the installed package root, targeting the running installed CLI.
- Atomic pointer replacement and regular `dist/bin.js` validation.
- A source-level runtime reporting `not_installed` and moving nothing.
- Configuration planning that reports hashes and field names, recognizes known CLI installs throughout raw JSON strings and argument lists, preserves explicit overrides, and migrates Node runtime pins only when their pointer exists.
- Configured-executable diagnostics at startup and in status.

Old-install pruning remains deferred pending an exact reference-aware plan.

## Guarded configuration transition

[ADR-0489](../../decisions/operations/services/0489-migrate-node-configurations-only-inside-the-service-transition.md) supersedes ADR-0488's in-place configuration replacement and its instruction to keep migrated configuration after replacement failure. It also clarifies ADR-0214's claim that configuration-only work leaves the service unchanged: the service definition may remain identical, but the service restarts.

The Node stage rechecks observations, updates the CLI pointer, validates rewritten paths, preserves the owner-only content-bound backup, and writes candidate bytes to a private temporary file. It passes that file as `--configuration-source` without overwriting the running Node's configuration.

The service transition freezes admission under the running configuration digest, stops the Node, replaces configuration and frozen binding together, and starts the replacement. A failed replacement restores original configuration bytes and binding with the previous definition. A configuration-only change uses the same guarded restart; an identical definition without a configuration transition remains a conflict.

Accepted migration differences are string leaves rewritten through `/runtimes/cli/current/` or `/runtimes/node/current/`, resolving to regular user-owned files that group and others cannot write. Other differences remain refused.

## Already migrated hosts

Already migrated hosts recover only through qualifying owner-only, single-link `.pre-adr-0488-<12 hex>` backups whose names bind their content and whose changes satisfy the migration restrictions above.

Recovery freezes under a matching predecessor digest and transitions the binding to the current configuration without rewriting already migrated bytes. Restoration reverses the binding and restores predecessor bytes. A concurrent requested replacement during recovery is refused.

## Failure behavior

| Condition | Result |
| --- | --- |
| Unexplained digest mismatch | `service_upgrade_config_mismatch` before stopping the service |
| Missing or conflicting admission sessions | `service_upgrade_fence_invalid` |
| Active work and an owned upgrade | `service_upgrade_work_busy` |
| Requested configuration transition without an installed service | `node_fleet_config_transition_unavailable` |

## Evidence and completion

ADR-0488's final statement that no installed host had migrated is historical to its original observation. ADR-0489 subsequently records in-place migrations and retained backups on WSL, with axli, flemo, and plen failing the fence.

That evidence proves neither successful guarded recovery nor current fleet readiness. Completion requires the corresponding inner service, readiness, and recovery receipts; orchestration output alone is insufficient.

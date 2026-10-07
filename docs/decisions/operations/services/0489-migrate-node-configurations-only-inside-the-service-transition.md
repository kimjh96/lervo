# ADR-0489: Migrate Node configurations only inside the service transition

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0488](0488-point-node-configurations-at-one-current-cli.md) (configuration apply), [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md) (Node service upgrade fence)

## Context

After ADR-0488 deployed at `f4185055`, `lervo upgrade --apply --safe` failed the `repository_node` stage for axli, flemo, and plen on WSL with `service_upgrade_fence_invalid` ("The repository Node service operation failed."). The Mac repository argo, which has no supervision configuration, upgraded normally.

ADR-0488 apply rewrote each Node configuration while its Node was running. The `*.pre-adr-0488-*` backups remain, and `outcomeSupervision.managedExecution.cliBundle` already names `~/.local/share/lervo/runtimes/cli/current/dist/bin.js`.

A running Node registers its node work admission session with the digest of the configuration read at startup. Node work admission is the SQLite record used to freeze new Node work during an upgrade. The fence attempted to freeze using the rewritten file's digest. Admission refused with `session_conflict`; the fence mapped every refusal other than active work to `service_upgrade_fence_invalid`. The configuration changed outside the service transition, and the error hid the reason.

## Decision

### Replace configurations only inside the guarded service transition

The `node` stage no longer writes the Node configuration. Apply still rechecks the plan, moves the CLI pointer, verifies that every rewritten path resolves, and writes the owner-only `.pre-adr-0488-<12 hex>` backup. It writes migrated bytes to a private temporary file and passes it to the service manager as `--configuration-source`.

The existing guarded configuration transition applies those bytes:

1. The fence freezes the admission scope under the running configuration's digest.
2. The service manager stops the Node.
3. The transition replaces the file and moves the frozen binding to the new digest with `replaceFrozenConfiguration`.
4. The replacement Node starts, registers the new digest, and completes the transition.

If the replacement does not stay active, the transition restores the original bytes and binding together with the previous definition.

The transition accepts an ADR-0488 migration only when every difference is a string leaf whose new value is an absolute path through a host pointer, `/runtimes/cli/current/` or `/runtimes/node/current/`. Each new path must resolve to a regular file owned by this user and not writable by group or others. All other differences remain refused.

When deployment is current and only the configuration changes, the service manager restarts the unchanged definition through this transition. An identical-definition upgrade is accepted only with a configuration transition; without one, it still fails with `service_state_conflict`. Node fleet apply does not roll back this restart because no other definition exists to restore.

### Recover already-migrated hosts through retained backups

If freeze is refused because the scope holds another configuration digest, the fence searches beside the configuration for retained backups. A backup qualifies only if:

- Its name is `<config>.pre-adr-0488-<12 hex>`.
- Those 12 hexadecimal digits prefix its own content digest.
- It is an owner-only regular file with one link.
- It differs from the current file only by ADR-0488 path rewrites to owned files.

The fence retries freeze with each qualifying digest. A match to the running Node's binding enables a recovery transition:

- **Apply:** rechecks the rewrite and moves the frozen binding from the predecessor digest to the current file's digest. It does not write the file, which already contains migrated bytes.
- **Restore:** moves the binding back first, then writes predecessor bytes. An interruption between these steps leaves a state this recovery accepts on the next run.

A configuration replacement requested while recovery is pending is refused with `service_upgrade_config_mismatch`.

### State the reason for fence refusals

Admission now returns `config_mismatch` when the scope binds another configuration digest. Previously it returned `session_conflict`, which still means multiple Node sessions hold the scope.

The fence maps refusals as follows:

- `active_work` and `upgrade_owned` → `service_upgrade_work_busy`, as before.
- `config_mismatch` without a qualifying backup → `service_upgrade_config_mismatch`.
- `session_missing` and `session_conflict` → `service_upgrade_fence_invalid`.

Each message states the reason, for example: "the running Node registered a different configuration digest than the file on disk, and no retained ADR-0488 predecessor matches it." Node fleet apply appends the service manager's message to "The repository Node service operation failed." Messages are fixed texts without paths.

## Events, state, and failure meaning

No event or host file is added.

- `config_mismatch` (admission freeze refusal): the scope binds a configuration digest other than the one the upgrade read.
- `service_upgrade_config_mismatch` (service upgrade): the running Node's configuration binding differs from the file on disk, and no retained predecessor explains it. The service is not stopped.
- `node_fleet_config_transition_unavailable` (Node fleet apply): configuration replacement was requested for a Node without an installed service.

## Compatibility and deploy order

On already-migrated hosts, the next `lervo upgrade --apply` freezes under the backup's digest, stops the old Node, moves the binding, and starts the replacement. No manual file edits or backup removal are needed.

1. Install the CLI release containing this decision.
2. Run `lervo upgrade --apply` in axli, flemo, and plen on WSL.

## Consequences

- Node configurations change only while their Nodes are stopped and frozen, moving admission bindings and files together.
- Configuration-only migration restarts the Node once instead of waiting for an unrelated restart.
- Fence refusals distinguish busy work, differing bindings, and missing sessions.

## Verification

Focused tests show:

- **Admission store:** mismatched digests are refused as `config_mismatch`.
- **Path rewrites:** only pointer-path moves qualify. Unrelated field changes, non-pointer paths, and identical files do not. Backups whose names do not bind their bytes are ignored.
- **Fence with real SQLite admission:** a Node keeps running during in-place configuration migration. Without a predecessor resolver, upgrade fails with `service_upgrade_config_mismatch` and the operation never runs. With the resolver, freeze uses the backup's digest and the replacement Node registers the migrated digest inside the freeze. Failed replacement restores predecessor bytes and binding.
- **Configuration transition:** ADR-0488 migration of `cliBundle` and an argument list applies and restores through `createNodeCliConfigurationTransition`.
- **Service manager with fake systemd and real admission:** an in-place migrated Node upgrades to a new definition. The same file without a backup fails with `service_upgrade_config_mismatch` before any stop. An unchanged definition with `--configuration-source` restarts into migrated bytes; without a transition, it remains refused.
- **CLI:** apply writes backup and candidate bytes while leaving the configuration file untouched.

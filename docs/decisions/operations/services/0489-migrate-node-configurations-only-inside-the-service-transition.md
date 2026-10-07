# ADR-0489: Migrate Node configurations only inside the service transition

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0488](0488-point-node-configurations-at-one-current-cli.md) (configuration apply), [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md) (Node service upgrade fence)

## Context

ADR-0488 was deployed at `f4185055`. On the WSL host, `lervo upgrade --apply --safe` then failed the `repository_node` stage for axli, flemo, and plen with `service_upgrade_fence_invalid` ("The repository Node service operation failed."). The Mac repository argo, which has no supervision configuration, upgraded normally.

The ADR-0488 apply wrote the migrated Node configuration in place while each Node kept running. The backups `*.pre-adr-0488-*` exist, and `outcomeSupervision.managedExecution.cliBundle` already names `~/.local/share/lervo/runtimes/cli/current/dist/bin.js`.

A running Node registers its node work admission session with the digest of the configuration file it read at startup. Node work admission is the SQLite record that lets an upgrade freeze new Node work. The upgrade fence then tried to freeze with the digest of the rewritten file. The admission store refused it as `session_conflict`, and the fence mapped every refusal other than active work to `service_upgrade_fence_invalid`. Two defects combined: the configuration changed outside the service transition, and the error hid its reason.

## Decision

### Only the guarded service transition replaces a Node configuration

The `node` stage no longer writes the Node configuration. Apply still rechecks the plan, moves the CLI pointer, checks that every rewritten path resolves, and writes the owner-only `.pre-adr-0488-<12 hex>` backup. It then writes the migrated bytes to a private temporary file and passes that file to the service manager as `--configuration-source`.

The existing guarded configuration transition applies the bytes:

1. The fence freezes the admission scope under the digest of the running configuration.
2. The service manager stops the Node.
3. The transition replaces the file and moves the frozen binding to the new digest with `replaceFrozenConfiguration`.
4. The replacement Node starts, registers the new digest, and the transition completes.

If the replacement does not stay active, the transition restores the original bytes and binding together with the previous definition.

The transition now accepts an ADR-0488 migration. That is a change in which every difference is a string leaf whose new value is an absolute path through a host pointer, `/runtimes/cli/current/` or `/runtimes/node/current/`. Each new path must resolve to a regular file that this user owns and that group and others cannot write. Any other difference is still refused.

When the deployment is current and only the configuration changes, the service manager restarts the unchanged definition through the same transition. An upgrade with an identical definition is accepted only with a configuration transition, and without one it still fails with `service_state_conflict`. The Node fleet apply does not roll back such a restart, because no other definition exists to roll back to.

### Hosts already migrated in place recover through their retained backup

When the freeze is refused because the scope holds a different configuration digest, the fence looks for retained backups beside the configuration. A backup qualifies when all of the following hold:

- Its name is `<config>.pre-adr-0488-<12 hex>`.
- Its 12 hexadecimal digits are the start of its own content digest.
- It is an owner-only regular file with one link.
- It differs from the current file only by ADR-0488 path rewrites to owned files.

The fence retries the freeze with each qualifying digest. When one matches the running Node's binding, the upgrade continues with a recovery transition:

- **Apply** checks the rewrite again and moves the frozen binding from the predecessor digest to the current file's digest. The file is not written, because it already holds the migrated bytes.
- **Restore** moves the binding back first and then writes the predecessor bytes. An interruption between the two leaves the same state that this recovery accepts on the next run.

A configuration replacement requested while such a recovery is pending is refused with `service_upgrade_config_mismatch`.

### Fence refusals name their reason

The admission store now returns `config_mismatch` when the scope binds another configuration digest. Before this change it returned `session_conflict`, which still means that more than one Node session holds the scope. The fence maps refusals as follows:

- `active_work` and `upgrade_owned` map to `service_upgrade_work_busy`, as before.
- `config_mismatch` without a qualifying backup maps to `service_upgrade_config_mismatch`.
- `session_missing` and `session_conflict` map to `service_upgrade_fence_invalid`.

Each message states the reason. For example: "the running Node registered a different configuration digest than the file on disk, and no retained ADR-0488 predecessor matches it." The Node fleet apply appends the service manager's message to "The repository Node service operation failed." Those messages are fixed texts without paths.

## Events, state, and failure meaning

No event or host file is added.

- `config_mismatch` (admission freeze refusal): the scope binds a configuration digest other than the one the upgrade read.
- `service_upgrade_config_mismatch` (service upgrade): the running Node's configuration binding differs from the file on disk, and no retained predecessor explains it. The service is not stopped.
- `node_fleet_config_transition_unavailable` (Node fleet apply): a configuration replacement was requested for a Node without an installed service.

## Compatibility and deploy order

On hosts that are already migrated, the next `lervo upgrade --apply` freezes under the backup's digest, stops the old Node, moves the binding, and starts the replacement. No file needs to be edited by hand, and no backup needs to be removed.

1. Install the CLI release that contains this decision.
2. Run `lervo upgrade --apply` in axli, flemo, and plen on WSL.

## Consequences

- A Node configuration changes only while its Node is stopped and frozen, so the admission binding and the file move together.
- A configuration-only migration restarts the Node once instead of waiting for an unrelated restart.
- A fence refusal says whether work is busy, the binding differs, or the session is missing.

## Verification

Focused tests show:

- **Admission store:** a mismatched digest is refused as `config_mismatch`.
- **Path rewrites:** only pointer-path moves are recognized. An unrelated field change, a move to a non-pointer path, and identical files are not. A backup whose name does not bind its bytes is ignored.
- **Fence with real SQLite admission:** a Node keeps running while its configuration is migrated in place. Without a predecessor resolver, the upgrade fails with `service_upgrade_config_mismatch` and the operation never runs. With the resolver, it freezes under the backup's digest, and the replacement Node registers the migrated digest inside the freeze. A failed replacement restores the predecessor bytes and binding.
- **Configuration transition:** an ADR-0488 migration of `cliBundle` and an argument list applies and restores through `createNodeCliConfigurationTransition`.
- **Service manager with a fake systemd and real admission:** the in-place migrated Node upgrades to a new definition. The same file without a backup fails with `service_upgrade_config_mismatch` before any stop. An unchanged definition with `--configuration-source` restarts into the migrated bytes. An unchanged definition without a transition is still refused.
- **CLI:** apply writes the backup and the candidate bytes but leaves the configuration file untouched.

# Service activation

On hosts with Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then explicitly activate the Node using the service renderer and manager.

For standalone `dist/bin.js`, pass its path as `--executable` and a verified Node.js binary as `--node-executable`. Activation must not rely on ambient `PATH` or a separate launcher. The rendered definition puts the bound Node and runtime directories before standard system directories in its private `PATH`, allowing configured JavaScript provider entrypoints to execute without inheriting an interactive shell.

After preflight, render and explicitly install the existing per-repository Node service. It starts `lervo-node --config`, keeps Discord and synchronization in one process lifecycle, restarts only on failure, and writes no credentials into the service definition:

```sh
pnpm service:render --manager launchd --runtime node --instance <nfi-id> \
  --executable <absolute-installed-path>/dist/bin.js \
  --node-executable <absolute-node-path> --config <absolute-config-path> \
  --output <new-absolute-definition-path>
pnpm service:manage install --source <absolute-definition-path> --write
```

Use `--manager systemd` on Linux.

## Guarded upgrades and rollback

For a configured supervised Node, `service:manage --action upgrade` and `rollback` acquire the repository supervision owner fence before stopping the old unit. `service_upgrade_supervision_busy` means a cycle remains active: leave the old service running and retry after it settles. Do not stop the unit manually to bypass the fence. This guard does not yet prove independent conversation turns are drained.

If an existing configuration directly pins an older deliberation CLI, prepare an exact owner-only candidate changing only its `cliExecutable` references. A guarded Node upgrade may add `--configuration-source <candidate.json>` while retaining the running configuration path. The manager verifies stop before replacing configuration bytes and the frozen admission digest; failure restores both before restarting the predecessor. An unresolved private transition journal requires recovery, not another unchecked attempt. Reader rehearsal must include these pinned CLI entrypoints before enabling a newer event writer.

Alternatively, the same guarded transition may add one already shared Discord channel to one identity, with no other candidate changes. For an organization-bound identity, rebind the durable deployment under the same stopped-service work freeze and restore its predecessor binding on rollback. Preflight the replacement after the rebind and observe the Node's `conversation.status: ready` after activation.

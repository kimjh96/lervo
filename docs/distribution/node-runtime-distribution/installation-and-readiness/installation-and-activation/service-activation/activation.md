# Install and activate the Node service

On hosts with Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then explicitly activate the Node using the service renderer and manager.

For standalone `dist/bin.js`, pass its path as `--executable` and a verified Node.js binary as `--node-executable`. Activation must not rely on ambient `PATH` or a separate launcher. The rendered definition places the bound Node and runtime directories before standard system directories in its private `PATH`, allowing configured JavaScript provider entrypoints to execute without inheriting an interactive shell.

After preflight, render and explicitly install the existing per-repository Node service. It starts `lervo-node --config`, keeps Discord and synchronization in one process lifecycle, restarts only on failure, and writes no credentials into the service definition:

```sh
pnpm service:render --manager launchd --runtime node --instance <nfi-id> \
  --executable <absolute-installed-path>/dist/bin.js \
  --node-executable <absolute-node-path> --config <absolute-config-path> \
  --output <new-absolute-definition-path>
pnpm service:manage install --source <absolute-definition-path> --write
```

Use `--manager systemd` on Linux.

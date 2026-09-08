# Installation and readiness

## Installation and preflight

Obtain the archive SHA-256 through a separate trusted channel and compare it with the platform SHA-256 tool. Extract into a new directory, then run:

```sh
node dist/bin.js --config <config.json>
```

Before activation, run the owner-only configuration and credential preflight:

```sh
node dist/bin.js --check-config <config.json>
```

Preflight performs no network or repository work.

## Service activation

On hosts with Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then explicitly activate the Node with the service renderer and manager.

For standalone `dist/bin.js`, pass its path as `--executable` and a verified Node.js binary as `--node-executable`. Activation must not rely on ambient `PATH` or a separate launcher.

After preflight, render and explicitly install the existing per-repository Node service. It starts `lervo-node --config`, keeps Discord and synchronization in one process lifecycle, restarts only on failure, and writes no credentials into the service definition:

```sh
pnpm service:render --manager launchd --runtime node --instance <nfi-id> \
  --executable <absolute-installed-path>/dist/bin.js \
  --node-executable <absolute-node-path> --config <absolute-config-path> \
  --output <new-absolute-definition-path>
pnpm service:manage install --source <absolute-definition-path> --write
```

Use `--manager systemd` on Linux.

## Moving a repository Node to another host

Stop the old Node before copying mutable state, and do not start both hosts against one deployment identity. A repository clone plus tracked files is insufficient: `.lervo/` contains repository-local event, CAS, knowledge, and workstream state, while hired agents and assignments use the repository-instance coordination home. For a Git worktree that home is `<git-common-dir>/lervo-coordination-v1`; for a standalone checkout it is `.lervo/data/repository-coordination-v1`.

Transfer both authorities as owner-only data, preserve their repository and project marker files exactly, and copy provider and Discord credentials separately into the destination's configured owner-only paths. Never place credentials in either state authority. Before activation, inspect the destination organization and agent projections and run `--check-config`; a newly initialized empty coordination home must not be accepted as equivalent to the source.

After the destination reports stable service-manager and runtime readiness, keep the old service disabled. A later move repeats the same single-writer handoff; shared network storage or simultaneous Nodes is not a substitute for an explicit active-host lease.

## Readiness

Check service-manager stability and the owner-only health snapshot separately. Discord readiness appears as `conversation.status: ready` only after Gateway READY or RESUMED authentication.

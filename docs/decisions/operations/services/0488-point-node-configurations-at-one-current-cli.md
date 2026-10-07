# ADR-0488: Point Node configurations at one current CLI

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md) (repository Node stage), [ADR-0483](../../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) (host pointers)
Related: [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md)

## Context

On the WSL host (main `a2bd3c7b`), old CLI install directories under `~/.local/lib/lervo-cli/` were deleted as cleanup. At their next restart, two Lervo Nodes crash-looped with this error:

```text
Lervo Node error (startup_failed): Could not open the Node runtime configuration. Cause: ENOENT ... lstat '/home/jonghyeok/.local/lib/lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js'
```

The Node configuration is the JSON file that each Node service passes with `--config`. It named the CLI by absolute, version-specific paths: 13 references to `.../lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js`, one to `.../lervo-cli/settled-3bd3a1c6-r1/dist/bin.js`, and one to `.../lervo-cli/settled-6c787cf8-r1/dist/bin.js`. The emergency fix linked those paths to the current CLI by hand.

ADR-0483 gave Node runtimes a per-host `current` pointer. The CLI that Node configurations name had no equivalent, so every CLI upgrade or cleanup could break a running Node at its next restart, without any warning beforehand. The startup error also blamed the configuration file, although the file was readable and only one executable inside it was missing.

## Decision

### Every host keeps one `current` CLI pointer

The CLI pointer directory sits beside the ADR-0483 Node runtimes. It is `~/Library/Application Support/Lervo/runtimes/cli` on macOS and `~/.local/share/lervo/runtimes/cli` elsewhere. It holds `current`, an absolute symbolic link to the physical package root of one installed CLI. A package root is the directory that holds `dist/bin.js`, for example `~/.local/lib/lervo-cli/<label>/node_modules/@lervo/cli`.

- Node configurations name `<cli>/current/dist/bin.js`. The path never changes across installs.
- The link targets the install instead of a copied payload, because the CLI package resolves its own `node_modules` dependencies. Node resolves the link, so module resolution happens inside the real install.
- The link is replaced by creating a temporary link and renaming it over `current`. A Node that starts during the swap sees the old install or the new one, never a partial state.
- The pointer only moves to a root that holds a regular `dist/bin.js`. A refused swap keeps the previous target.

The pointer follows the CLI that runs `lervo upgrade`. That is the same rule ADR-0483 applies to the Node runtime, which `lervo upgrade` installs from the running CLI's bundle. A CLI that does not run from a built `dist/bin.js`, such as a source-level test, reports `not_installed` and moves nothing.

### The repository Node stage maintains the pointer and migrates the configuration

The `node` stage of `lervo upgrade` now inspects a third input next to the runtime payload and the service definition. The stage field `configExecutables` reports it:

- `cliPointer`: `current`, `create`, `update`, or `not_installed`.
- `config`: `current`, `migrate`, or `unreadable`, with `sourceHash` and `migratedHash`.
- `rewrittenFields`, `overrideFields`, and `retainedFields`: configuration field names such as `discordConversations[3].deliberation.cliExecutable`.

The plan carries hashes, field names, and a digest of the install root, never paths. Field names include array positions, so they identify a field without exposing its value.

The migration rewrites the raw configuration JSON. Every string anywhere in the file is checked, because the incident's pins sat in CLI fields and in argument lists alike:

- **CLI install path.** A string `<root>/dist/<file>` is rewritten to `<cli>/current/dist/<file>` when `<file>` is one of the CLI's published files (`bin.js`, `node-runtime.js`, `terminal-hook.js`) and `<root>` is known as a CLI install. A root is known when a CLI field (`deliberation.cliExecutable` or `outcomeSupervision.managedExecution.cliBundle`) names `<root>/dist/bin.js`, or when `<root>` is an `@lervo/cli` package under `node_modules`. A root is also known when it shares an install parent with such a package or with the running CLI. The install parent is the directory that holds labelled installs, here `~/.local/lib/lervo-cli`. This rule recognizes the `settled-*-r1` builds wherever they appear.
- **Node runtime path.** A string `<runtimes>/<hash16>/...` becomes `<runtimes>/current/...` once the ADR-0483 pointer exists. Until then the field is retained and reported, and a later upgrade migrates it after the `replica_service` stage creates the pointer.
- **Override.** Any other value in a CLI field stays unchanged. It is reported as an override that will not follow later installs.

A current deployment whose pointer or configuration is stale plans `safe_apply` with reason `node_config_executables_stale`. This also applies when the deployment would otherwise be `blocked` by a failing runtime, because a missing executable is a common cause of that failure. Such an apply changes only the pointer and the configuration. A running Node keeps its resolved paths and reads the new configuration at its next start. A deployment change still replaces the Node service as before.

On apply, the stage performs these steps in order:

1. It re-inspects and refuses a changed observation with `node_config_executables_plan_stale`.
2. It points `current` at the running CLI install.
3. It checks that every rewritten path resolves, or fails with `node_config_executable_unresolved`.
4. It rechecks the configuration bytes against `sourceHash`.
5. It exclusively writes the original bytes to `<config>.pre-adr-0488-<12 hex>` with mode 0600. The suffix is the start of the source hash. An identical existing backup is reused, and a different one fails with `node_config_backup_conflict`.
6. It writes the migrated bytes to a private temporary file with mode 0600 and renames it over the configuration.
7. When the deployment also changes, it runs the existing transactional Node replacement.

A failed replacement restores the previous service but keeps the migrated configuration. Its paths resolve to the installed CLI, and the original paths may no longer exist. The backup keeps the original bytes for manual recovery.

### Startup names the missing executable

Before it opens the deployment, the Node checks every executable that it needs to start. Today that is each `deliberation.cliExecutable`. When one is missing, is not a file, or is not executable, startup fails with code `configured_executable_unavailable`:

```text
Lervo Node error (configured_executable_unavailable): The executable configured at discordConversations[1].deliberation.cliExecutable does not exist: <path>. Run `lervo upgrade` to point it at the installed CLI.
```

`--check-config` runs the same check. The check follows symbolic links, so a path through `<cli>/current` is judged by its target. Executables that only some work needs keep their existing failure at use, so a missing provider binary does not stop synchronization.

### Node status reports configured executables before a restart

`lervo repository node status` follows each registered Node's installed service definition to its configuration. For each instance it reports `configuredExecutables`:

- `status`: `ready`, `attention`, or `unavailable`. `attention` means at least one configured executable is missing, is not a file, or cannot be used. `unavailable` means the definition or configuration could not be read.
- `missing`: the field, path, kind, and problem of each unusable executable. Kinds are `lervo_cli`, `node`, `provider`, `verification_tool`, and `requested_runtime`.
- `pinnedFields`: the fields that the next `lervo upgrade` would move to a host pointer.

An instance in `attention` makes the fleet `degraded` and the command exit 1. The text output prints one line per missing executable and names `lervo upgrade` as the remedy. This report is local command output, so it may include host paths.

### Deferred: pruning old installs

Pruning unreferenced CLI and runtime installs is deferred. A safe pruner must prove that no service definition, Node configuration, pointer, or shell entry such as `~/.local/bin/lervo` references an install before it deletes one. That proof needs its own plan and apply contract. The follow-up is a `lervo upgrade` stage that lists every install under the CLI install parents and the Node runtimes directory with the reference that keeps it, and deletes only unreferenced installs after an exact approval. Its verification must show that an install named by any of those references is never deleted.

## Events, state, and failure meaning

No event is added.

New host state:

- The `current` CLI pointer. It is host-local, holds one absolute install path, and is never synchronized. A missing or relative link means no pointer, and the next upgrade creates it.
- `<config>.pre-adr-0488-<12 hex>`: an owner-only backup of a migrated Node configuration, written once per source content.

New failure codes:

- `configured_executable_unavailable` (Node startup): a startup executable is unusable. The message names the field and path.
- `node_config_executables_plan_stale` (upgrade apply): the pointer or configuration changed after approval. Nothing was rewritten.
- `node_config_executable_unresolved` (upgrade apply): a rewritten path does not resolve after the pointer moved. The configuration is unchanged.
- `node_config_backup_conflict` (upgrade apply): a backup with the same name holds different bytes. The configuration is unchanged.

New stage reason: `node_config_executables_stale`.

## Compatibility and deploy order

An older Node runtime reads the migrated configuration unchanged, because only path strings change. A configuration that still pins a version-specific path keeps working until that install is removed, and `lervo repository node status` reports the pin before then.

1. Install the CLI release that contains this decision.
2. Run `lervo upgrade` in each repository with a registered Node and apply its plan. The first apply creates the pointer and migrates that repository's Node configuration.
3. Check `lervo repository node status`. Every instance should report `executables=ready; pinned=0`.

After that, old CLI installs can be removed once no other reference remains. On the incident host, the emergency symbolic links can then be deleted.

## Consequences

- Removing an old CLI install no longer breaks a Node at its next restart, once `lervo upgrade` has migrated the configuration.
- Later CLI upgrades move only the pointer. Node configurations stay byte-identical.
- A missing executable is named at startup and visible in status before the restart.
- The host pointer follows whichever CLI ran the last `lervo upgrade`. Running the upgrade from a development build points the host at that build, as it already does for the Node runtime.

## Verification

Focused tests show:

- **Pointer:** it is created, kept, and swapped only to an install with a regular `dist/bin.js`. A refused swap keeps the previous target and leaves no temporary link. The running install resolves only from a built `dist/bin.js`.
- **Migration planning:** the incident configuration's 13 `convergence-0.18.0` pins and both `settled-*-r1` pins move to `<cli>/current/dist/bin.js`, in CLI fields and argument lists alike. `/usr/bin/node` and an unrelated `/opt/tools/dist/bin.js` keep their bytes. A sibling install is recognized only through a known install parent. A configuration that names the pointer is current, and a non-install CLI value is reported as an override. A Node runtime pin moves only once the runtime pointer exists. Invalid JSON is refused.
- **Upgrade apply:** the plan exposes field names and no paths. Apply creates the pointer, rewrites both CLI fields, writes a mode-0600 configuration and a mode-0600 backup of the original bytes, and plans `current` afterward. A later install moves only the pointer, and the configuration bytes stay identical. A configuration changed after planning is refused. A CLI that is not an installed build plans nothing.
- **Startup:** every absolute executable field is listed with its kind. A removed install, a non-file, and a non-executable path are reported. Startup names the field and path of a removed CLI install and accepts the configuration once the path resolves.
- **Status:** a removed CLI install is reported by field and path with `attention` and as a pinned field. A resolving configuration is `ready`, and an unreadable service definition is `unavailable`. The text output names the missing field and the `lervo upgrade` remedy.

No installed host has been migrated by this change. The incident host still runs on the emergency links until `lervo upgrade` is applied there.

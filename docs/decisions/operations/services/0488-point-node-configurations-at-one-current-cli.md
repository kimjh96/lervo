# ADR-0488: Point Node configurations at one current CLI

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md) (repository Node stage), [ADR-0483](../../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) (host pointers)
Related: [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md)
Amended by: [ADR-0489](0489-migrate-node-configurations-only-inside-the-service-transition.md) (configuration changes only inside the guarded service transition)

## Context

On the WSL host (main `a2bd3c7b`), cleanup deleted old CLI installs under `~/.local/lib/lervo-cli/`. At their next restart, two Lervo Nodes crash-looped:

```text
Lervo Node error (startup_failed): Could not open the Node runtime configuration. Cause: ENOENT ... lstat '/home/jonghyeok/.local/lib/lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js'
```

Each Node service passes its JSON configuration with `--config`. The configurations pinned absolute CLI paths: 13 references to `.../lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js`, one to `.../lervo-cli/settled-3bd3a1c6-r1/dist/bin.js`, and one to `.../lervo-cli/settled-6c787cf8-r1/dist/bin.js`. Emergency symbolic links redirected those paths to the current CLI.

ADR-0483 supplied a per-host `current` pointer for Node runtimes, but configured CLIs had no equivalent. An upgrade or cleanup could therefore break a running Node at its next restart without warning. Startup also blamed the readable configuration file instead of its missing executable.

## Decision

### Every host keeps one `current` CLI pointer

The CLI pointer directory sits beside the ADR-0483 Node runtimes: `~/Library/Application Support/Lervo/runtimes/cli` on macOS and `~/.local/share/lervo/runtimes/cli` elsewhere. Its `current` entry is an absolute symbolic link to one installed CLI's physical package root: the directory containing `dist/bin.js`, for example `~/.local/lib/lervo-cli/<label>/node_modules/@lervo/cli`.

- Node configurations use `<cli>/current/dist/bin.js`, a stable path across installs.
- The link targets the install rather than a copied payload so the CLI resolves its own `node_modules` dependencies. Node resolves the link and performs module resolution inside the real install.
- Replacement creates a temporary link and renames it over `current`. A Node starting during the swap sees either the old or new install, never a partial state.
- The pointer moves only to a root containing a regular `dist/bin.js`; refusal preserves the previous target.

The pointer follows the CLI running `lervo upgrade`, matching ADR-0483's rule for the Node runtime installed from that CLI's bundle. A CLI not running from a built `dist/bin.js`, such as a source-level test, reports `not_installed` and moves nothing.

### The repository Node stage maintains the pointer and migrates the configuration

Alongside the runtime payload and service definition, the `node` stage inspects configured executables. Its `configExecutables` field reports:

- `cliPointer`: `current`, `create`, `update`, or `not_installed`.
- `config`: `current`, `migrate`, or `unreadable`, with `sourceHash` and `migratedHash`.
- `rewrittenFields`, `overrideFields`, and `retainedFields`: field names such as `discordConversations[3].deliberation.cliExecutable`.

The plan contains hashes, field names, and an install-root digest, never paths. Array positions identify fields without exposing their values.

Migration rewrites raw configuration JSON, checking every string because the incident's pins appeared in both CLI fields and argument lists:

- **CLI install path:** Rewrite `<root>/dist/<file>` to `<cli>/current/dist/<file>` only when `<file>` is a published CLI file (`bin.js`, `node-runtime.js`, or `terminal-hook.js`) and `<root>` is a known CLI install. A root is known if a CLI field (`deliberation.cliExecutable` or `outcomeSupervision.managedExecution.cliBundle`) names `<root>/dist/bin.js`, if it is an `@lervo/cli` package under `node_modules`, or if it shares an install parent with such a package or the running CLI. The install parent holds labelled installs, here `~/.local/lib/lervo-cli`. This recognizes `settled-*-r1` builds wherever they appear.
- **Node runtime path:** Rewrite `<runtimes>/<hash16>/...` to `<runtimes>/current/...` once the ADR-0483 pointer exists. Until then, retain and report the field; a later upgrade migrates it after `replica_service` creates the pointer.
- **Override:** Retain any other value in a CLI field and report it as an override that will not follow later installs.

A current deployment with a stale pointer or configuration plans `safe_apply` with reason `node_config_executables_stale`. This also applies when a failing runtime would otherwise make the deployment `blocked`, since a missing executable commonly causes that failure. Such an apply changes only the pointer and configuration. ADR-0489 applies the configuration inside the guarded service transition, restarting the unchanged definition. A deployment change still replaces the Node service as before.

Apply performs these steps in order:

1. Re-inspect; refuse a changed observation with `node_config_executables_plan_stale`.
2. Point `current` at the running CLI install.
3. Verify every rewritten path resolves; otherwise fail with `node_config_executable_unresolved`.
4. Recheck configuration bytes against `sourceHash`.
5. Exclusively write the original bytes to `<config>.pre-adr-0488-<12 hex>` with mode 0600. The suffix is the start of the source hash. Reuse an identical existing backup; fail with `node_config_backup_conflict` if its bytes differ.
6. Write migrated bytes to a private mode-0600 temporary file and rename it over the configuration.
7. If the deployment also changes, run the existing transactional Node replacement.

A failed replacement restores the previous service but retains the migrated configuration: its paths resolve to the installed CLI, while the original paths may no longer exist. The backup preserves original bytes for manual recovery.

### Startup names the missing executable

Before opening the deployment, the Node checks every executable needed for startup—currently each `deliberation.cliExecutable`. A missing, non-file, or non-executable path fails startup with `configured_executable_unavailable`:

```text
Lervo Node error (configured_executable_unavailable): The executable configured at discordConversations[1].deliberation.cliExecutable does not exist: <path>. Run `lervo upgrade` to point it at the installed CLI.
```

`--check-config` performs the same check. Checks follow symbolic links, judging `<cli>/current` paths by their targets. Executables needed only for some work retain their existing failure at use, so a missing provider binary does not stop synchronization.

### Node status reports configured executables before a restart

`lervo repository node status` follows each registered Node's installed service definition to its configuration. Each instance reports `configuredExecutables`:

- `status`: `ready`, `attention`, or `unavailable`. `attention` means at least one configured executable is missing, is not a file, or cannot be used. `unavailable` means the definition or configuration could not be read.
- `missing`: each unusable executable's field, path, kind, and problem. Kinds are `lervo_cli`, `node`, `provider`, `verification_tool`, and `requested_runtime`.
- `pinnedFields`: fields the next `lervo upgrade` would move to a host pointer.

An instance in `attention` makes the fleet `degraded` and the command exit 1. Text output prints one line per missing executable and names `lervo upgrade` as the remedy. This local command output may include host paths.

### Deferred: pruning old installs

Pruning unreferenced CLI and runtime installs is deferred. Before deleting an install, a safe pruner must prove that no service definition, Node configuration, pointer, or shell entry such as `~/.local/bin/lervo` references it. That proof requires its own plan and apply contract.

The follow-up is a `lervo upgrade` stage listing every install under the CLI install parents and Node runtimes directory, with the reference retaining it. It deletes only unreferenced installs after exact approval. Verification must show that an install named by any of those references is never deleted.

## Events, state, and failure meaning

No event is added.

New host state:

- The `current` CLI pointer is host-local, contains one absolute install path, and is never synchronized. A missing or relative link means no pointer; the next upgrade creates it.
- `<config>.pre-adr-0488-<12 hex>` is an owner-only backup of a migrated Node configuration, written once per source content.

New failure codes:

- `configured_executable_unavailable` (Node startup): a startup executable is unusable; the message names its field and path.
- `node_config_executables_plan_stale` (upgrade apply): the pointer or configuration changed after approval; nothing was rewritten.
- `node_config_executable_unresolved` (upgrade apply): a rewritten path does not resolve after the pointer moved; the configuration is unchanged.
- `node_config_backup_conflict` (upgrade apply): a same-name backup contains different bytes; the configuration is unchanged.

New stage reason: `node_config_executables_stale`.

## Compatibility and deploy order

Older Node runtimes read migrated configurations unchanged because only path strings change. Version-pinned configurations keep working until the referenced install is removed; `lervo repository node status` reports the pin beforehand.

1. Install the CLI release containing this decision.
2. Run `lervo upgrade` in each repository with a registered Node and apply its plan. The first apply creates the pointer and migrates that repository's Node configuration.
3. Run `lervo repository node status`; every instance should report `executables=ready; pinned=0`.

Old CLI installs may then be removed once no other reference remains. The incident host's emergency symbolic links can then be deleted.

## Consequences

- After configuration migration through `lervo upgrade`, removing an old CLI install no longer breaks a Node at its next restart.
- Later CLI upgrades move only the pointer; Node configurations stay byte-identical.
- Missing executables are named at startup and visible in status before restart.
- The host pointer follows whichever CLI last ran `lervo upgrade`. Upgrading from a development build points the host to that build, as already happens for the Node runtime.

## Verification

Focused tests show:

- **Pointer:** Create, retain, and swap the pointer only to an install containing a regular `dist/bin.js`. A refused swap retains the previous target and leaves no temporary link. The running install resolves only from a built `dist/bin.js`.
- **Migration planning:** Move all 13 incident `convergence-0.18.0` pins and both `settled-*-r1` pins to `<cli>/current/dist/bin.js`, in CLI fields and argument lists. Preserve `/usr/bin/node` and unrelated `/opt/tools/dist/bin.js` bytes. Recognize a sibling install only through a known install parent. Treat a configuration naming the pointer as current and report a non-install CLI value as an override. Move a Node runtime pin only after its pointer exists. Refuse invalid JSON.
- **Upgrade apply:** Expose field names and no paths in the plan. Create the pointer, rewrite both CLI fields, write a mode-0600 configuration and mode-0600 backup of original bytes, and subsequently plan `current`. A later install moves only the pointer, leaving configuration bytes identical. Refuse configuration changes after planning. A CLI that is not an installed build plans nothing.
- **Startup:** List every absolute executable field with its kind. Report removed installs, non-files, and non-executable paths. For a removed CLI install, startup names the field and path, then accepts the configuration once the path resolves.
- **Status:** Report a removed CLI install by field and path with `attention` and as a pinned field. A resolving configuration is `ready`; an unreadable service definition is `unavailable`. Text output names the missing field and `lervo upgrade` remedy.

No installed host has been migrated by this change. The incident host still uses emergency links until `lervo upgrade` is applied there.

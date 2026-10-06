# ADR-0470: Admit every knowledge resident and run one host resident service

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md) (event writer and host service stages), [ADR-0164](0164-user-runtime-service-management-boundary.md) (knowledge host target), [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) (resident admission, doctor)
Related: [ADR-0471](../../coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md), [Event writer activation](../../../foundation/event-writer-rollout/activation.md), [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

After CLI 0.20.0 (ADR-0469) was deployed on the owner's Mac on 2026-10-06:

1. The host resident (`lervo knowledge worker --watch --host`) served only lervo. axli, plen, and shiflo wrote event schema 3 and digimon schema 1. The resident skipped every checkout whose writer was older than schema 4 without a log line, a heartbeat, or a doctor finding. The Node resident child exited on the same condition, and a Node without outcome supervision started nothing.
2. `lervo knowledge convergence doctor` told the owner to register a Node or run `lervo knowledge worker --watch`, although the host resident was running.
3. `lervo upgrade` had no event writer stage, so no repository upgrade moved a checkout to schema 4. The owner ran the local-only activation procedure by hand after copying `.lervo/data/events.sqlite`.
4. Nothing installed the host resident service. The owner wrote a launchd plist by hand. A fresh host, or a new project on a host without a Node, ran no continuity. This breaks the owner's applied rule that existing and future projects are maintained automatically on Mac or WSL without disrupting development.
5. CI never ran `pnpm test` or the release manifest and SBOM checks on ordinary pull requests, so a stale SBOM and a terminal hook size regression reached `main`.
6. Rendered service definitions had a fixed `PATH`. On macOS with Homebrew, `codex`, `claude`, and `gh` live in `/opt/homebrew/bin`, so the argo Node's resident could not start its provider and publication found no `gh`.

## Decision

### Event writer stage in `lervo upgrade`

The repository upgrade plan gains an `eventWriter` stage. It targets schema 4, the schema the knowledge resident writes, and composes the existing event-contract contract without a new one: collect reader evidence, plan, and apply the exact current plan ID with re-observed evidence, as `lervo event-contract activate --apply` does. Plan blockers and evidence failures are never bypassed; each becomes an upgrade blocker with an exact remedy.

The stage adds one local-reader preflight. The generated terminal hook runtime embeds its own event reader. If it would change (`update` or `blocked`), the stage reports `terminal_hook_reader_stale`. Stage dependencies make the order explicit:

| Stage          | Requires                                        |
| -------------- | ----------------------------------------------- |
| `event_writer` | `terminal_integration` and `node` applied first |
| `host_service` | Nothing                                         |

The outer plan binds the reader observation hash, which excludes the observation time, and the current coordinate hash. Apply re-observes both and fails with `event_writer_plan_stale` when either changed. A stage deferred behind the hook runtime or the Node applies only if it has become ready in the same run; otherwise it is skipped with its blockers.

Before applying, the stage writes a recoverable backup to `.lervo/data/event-writer-backups/schema-4/`: a `VACUUM INTO` snapshot of `events.sqlite`, a copy of `event-contract.json` when present, and `backup.json` (`kind`, `createdAt`, `planId`, `targetEventSchemaVersion`, `eventDatabase`, `coordinate`). `VACUUM INTO` is transactionally consistent while other processes append, so writers need not stop. Each target version keeps only its latest backup. A backup failure (`event_writer_backup_failed`) activates nothing.

- **Local-only checkouts**, and Hub-enabled checkouts without a registered Node (`repository_node_absent_v1`), activate within the reviewed upgrade apply.
- **Hub-enabled checkouts with a Node** follow the Hub-enabled procedure automatically. Evidence and apply each re-observe the fleet registry, service definition, Node health (at most two minutes old), and the Hub's identity-bound capability. A stale Node, an unreachable Hub, or a reader that cannot read schema 4 reports its code and remedy, for example `reader_inventory_hub_unavailable`. Hub synchronization is never disabled to pass the gate.

Writers that opened storage before activation keep their selected version until they reopen it. Every local reader reads schemas 1 through 4, so the mixed history stays readable.

### Resident admission

A resident that should run for a checkout but whose writer is older than schema 4 is **held**, never skipped. A held resident heartbeats state `attention` with reason `event_schema_outdated` in the checkout's private resident health store every 60 seconds.

- **Host resident.** Checkouts it serves have no Node, so their reader inventory is local. Under invariant 10, an owner who installed or adopted a continuity policy has consented to background knowledge on the host, and the activation writes only untracked, Lervo-managed local data with a backup. The activation contract permits local-only activation when the local runtime is the only reader. The host resident therefore runs the same local-only activation itself: the hook reader preflight, the backup, and the exact plan apply. If activation is blocked, the checkout stays held with the blocker code. A held checkout retries at most every 30 minutes; between retries each scan reads only the writer coordinate, so an activation done elsewhere is picked up within one scan. The host resident never runs distributed (Node and Hub) activation.
- **Node resident.** A Node never activates its own writer, because that needs the Hub-enabled procedure. Its resident child now starts even when the writer is outdated, holds with `event_schema_outdated`, rereads the coordinate every 60 seconds, and starts the ordinary resident as soon as `lervo upgrade` selects schema 4. No Node restart is needed. A Node that runs no child keeps an in-process hold beside its existing outcome-supervision loop.
- **Onboarding.** `lervo init` and `lervo repository register --write` run the same local-only activation before their continuity reconciliation, so a new project on a host with an active policy starts at schema 4.

### Host resident status and lock

`knowledge-host-resident.json` in the user state directory (owner-only, at most 128 KiB, rewritten after each scan and every 60 seconds) records:

- Required fields: `schemaVersion` (1), `pid`, `startedAt`, `heartbeatAt`, `launch` (`service | manual`), `role` (`active | standby`), and `repositories`, at most 256. Each repository has `repositoryRoot`, `state` (`serving | held | node_served | not_enrolled`), and `reason` and `detail` as closed codes or null.
- Privacy: absolute checkout roots that the host registry already lists, plus closed codes. No messages, addresses, credentials, or provider output. It never leaves the host and is rebuildable.
- Failure meaning: a heartbeat older than three minutes, or a dead PID, means no host resident runs. An unreadable file means unknown, never healthy.

`knowledge-host-resident.lock` names its holder's PID. Only the holder serves; a second host resident (for example a hand-written service beside the managed one) stays `standby` and takes over when the holder exits. A lock whose holder is gone is replaced. The per-repository worker lock and full-cycle admission remain the exclusivity authority for knowledge work, so even a lost lock race cannot duplicate a cycle.

### Host resident service lifecycle

The upgrade plan gains a `hostService` stage for this host's one host resident service. It applies only when at least one registered checkout has no Node and has a delegation or an active continuity policy that can seed one. Checkouts that a Node serves are skipped, as before.

- Targets: `~/Library/LaunchAgents/com.lervo.knowledge.host.plist` (launchd `gui/<uid>`) and `~/.config/systemd/user/lervo-knowledge-host.service` (systemd user). The release-tested renderer and manager (`pnpm service:render`, `pnpm service:manage`) gain the `knowledge-host` runtime. It binds the exact Node executable and installed CLI entry point and runs `knowledge worker --watch --host --config <path>`. Install, exact-predecessor upgrade, compensation, and status keep ADR-0164's semantics; differing bytes are never overwritten.
- `knowledge-host/config.json` in the user state directory (owner-only, at most 16 KiB): `schemaVersion` (1), `userStateDirectory`, and `provider` (null or a provider name). Lervo creates it once and never rewrites a valid file. An invalid file blocks the stage (`host_service_config_invalid`).
- The plan exposes only the manager, service label, action (`install | activate | upgrade`), definition and configuration hashes, repository counts, and whether an unmanaged host resident is running. It contains no paths. Apply re-plans and fails with `host_service_plan_stale` if anything changed, then runs the manager with `--write`. A manager that is unavailable (for example WSL without systemd) blocks with its remedy. An unsupported OS stays `pending_authority` (`service_manager_unsupported`).
- The installed CLI path changes with each CLI release. The next `lervo upgrade` therefore reports `host_service_outdated` and replaces the service transactionally.

No new event is emitted. The service manager result is an observation, not readiness evidence, as in ADR-0164.

### Service tool directories

A service manager starts services without a login shell, so the renderer accepts `--path-directories <dir:dir>`. Those directories join the service `PATH` after the runtime directories and before the fixed system directories. Without them, the rendered bytes are exactly those of earlier releases. The planner resolves them against the planning shell's `PATH`, in this order: each provider the service runs, `git`, then `gh` (optional). It records the first directory that holds each one.

- **Host resident service:** the providers of every checkout it serves.
- **Repository Node:** the provider of its knowledge resident (delegation or host policy) and of outcome supervision.

The directories are part of the rendered definition, so the reviewed plan hash binds them. A missing provider or `git` blocks the stage with `service_tool_unresolved` and names the tool. The Node stage now compares the full desired definition hash, not only the launcher path. A changed definition, such as a hand-edited `PATH`, reports `node_service_definition_changed` and is replaced through the exact-predecessor upgrade. `lervo repository node apply` resolves the same directories.

### Doctor

The doctor reads the host resident status, the Node fleet, and each checkout's resident health:

| Code                                            | Severity  | Meaning                                                                                                                             |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `event_schema_outdated`                         | attention | A resident is held; the detail names the activation blocker                                                                         |
| `continuity_pending`                            | info      | The host resident serves this checkout and has not reconciled yet                                                                   |
| `continuity_unobserved`, `resident_not_running` | attention | Detail `node_served` points at the Node; `host_resident_absent` points at `lervo upgrade`, which installs the host resident service |

The remediation for a held or unserved checkout is never "register a Node or run worker --watch" while a host resident serves it.

### Continuous integration

The code-quality workflow adds two pull-request and `main` jobs on `ubuntu-latest` with Node 22.13.0:

- `release-artifacts`: `pnpm build`, `pnpm release:manifest:check`, and `pnpm release:sbom:check`.
- `test`: `pnpm build`, then `pnpm test`, sharded across four runners with two workers each, a 30-second default test deadline, and a 45-minute timeout per shard. A vitest setup file points `LERVO_USER_STATE_DIRECTORY` at a per-process temporary directory, so no test reads or writes a developer's real host registry, policy, or services.

## Failure meaning

- `event_writer_plan_stale` and `host_service_plan_stale`: inputs changed after planning, so nothing in that stage was applied.
- `event_writer_backup_failed`: no activation happened.
- `service_tool_unresolved`: a required provider or `git` is missing from the planning shell's `PATH`, so the service stage was not applied.
- A held resident does no knowledge work. Its heartbeat proves only that a host process intends to serve the checkout and why it cannot.
- Writer activation errors keep their event-contract meanings (`event_writer_recovery_required`, `event_writer_activation_blocked`, and the reader inventory codes).

## Consequences

- One reviewed `lervo upgrade --apply` per host brings every local-only checkout to schema 4, installs or refreshes the host resident service, and leaves Hub-enabled checkouts current or blocked with exact remedies.
- New projects reach schema 4 at `lervo init`, and the installed host resident serves them within one five-minute scan.
- The doctor and attention report every held or unserved checkout with its cause.

## Deferred

- Retiring a hand-written host resident service. It stays installed and on standby until the owner removes it.
- Pruning release-specific CLI installation directories. A service whose CLI directory was removed before the next upgrade fails to start until `lervo upgrade` replaces it.

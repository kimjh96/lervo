# ADR-0470: Admit every knowledge resident and run one host resident service

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md) (event writer and host service stages), [ADR-0164](0164-user-runtime-service-management-boundary.md) (knowledge host target), [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) (resident admission, doctor)
Related: [ADR-0471](../../coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md), [Event writer activation](../../../foundation/event-writer-rollout/activation.md), [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Amended by: [ADR-0483](../../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) (replica service stage, current runtime pointer)

## Context

After CLI 0.20.0 (ADR-0469) reached the owner's Mac on 2026-10-06:

1. The host resident (`lervo knowledge worker --watch --host`) served only lervo. axli, plen, and shiflo wrote event schema 3; digimon wrote schema 1. Checkouts below schema 4 were silently skipped without logs, heartbeats, or doctor findings. The Node resident child exited on the same condition; a Node without outcome supervision started nothing.
2. `lervo knowledge convergence doctor` advised registering a Node or running `lervo knowledge worker --watch` despite the running host resident.
3. `lervo upgrade` had no event writer stage, so repository upgrades never selected schema 4. The owner manually performed local-only activation after copying `.lervo/data/events.sqlite`.
4. Nothing installed the host resident service; the owner manually wrote a launchd plist. Fresh hosts and new projects on hosts without a Node ran no continuity, violating the owner's applied rule: automatically maintain existing and future projects on Mac or WSL without disrupting development.
5. Ordinary pull requests omitted `pnpm test`, release manifest checks, and SBOM checks. A stale SBOM and terminal hook size regression reached `main`.
6. Service definitions used fixed `PATH`. On macOS with Homebrew, `codex`, `claude`, and `gh` live in `/opt/homebrew/bin`; the argo Node's resident could not start its provider, and publication could not find `gh`.

## Decision

### Event writer stage in `lervo upgrade`

Add an `eventWriter` repository upgrade stage targeting schema 4, which the knowledge resident writes. Reuse the existing event-contract contract: collect reader evidence, plan, then apply the exact current plan ID with re-observed evidence, as `lervo event-contract activate --apply` does. Never bypass plan blockers or evidence failures; expose each as an upgrade blocker with an exact remedy.

Local-reader preflight checks the generated terminal hook runtime's embedded event reader. If the runtime would change (`update` or `blocked`), report `terminal_hook_reader_stale`. Under [ADR-0539](../../execution/providers/hooks/0539-keep-the-terminal-hook-runtime-host-local-behind-a-tracked-launcher.md), preflight verifies the currently published host runtime. It accepts a valid compatible runtime from another live publisher without requiring the resident's embedded hash. Missing, invalid, or marked state still blocks readiness. The resident has repair authority and cannot revert a newer published runtime while its publisher entry exists.

| Stage | Requires |
| --- | --- |
| `event_writer` | `terminal_integration` and `node` applied first |
| `host_service` | Nothing |

The outer plan binds the reader observation hash, excluding observation time, and current coordinate hash. Apply re-observes both; a change to either fails with `event_writer_plan_stale`. A stage deferred behind the hook runtime or Node applies only if ready in the same run; otherwise skip it with its blockers.

Before applying, write a recoverable backup in `.lervo/data/event-writer-backups/schema-4/`:

- A `VACUUM INTO` snapshot of `events.sqlite`.
- A copy of `event-contract.json`, when present.
- `backup.json` containing `kind`, `createdAt`, `planId`, `targetEventSchemaVersion`, `eventDatabase`, and `coordinate`.

`VACUUM INTO` remains transactionally consistent during concurrent appends; writers need not stop. Keep only the latest backup per target version. Backup failure (`event_writer_backup_failed`) activates nothing.

- Local-only checkouts and Hub-enabled checkouts without a registered Node (`repository_node_absent_v1`) activate within the reviewed upgrade apply.
- Hub-enabled checkouts with a Node automatically use the Hub-enabled procedure. Evidence and apply each re-observe the fleet registry, service definition, Node health at most two minutes old, and Hub identity-bound capability. A stale Node, unreachable Hub, or reader unable to read schema 4 reports its code and remedy, such as `reader_inventory_hub_unavailable`. Never disable Hub synchronization to pass the gate.

Writers that opened storage before activation retain their selected version until reopening. Every local reader reads schemas 1 through 4, preserving mixed-history readability.

### Resident admission

A resident responsible for a checkout with a writer below schema 4 is held, never skipped. Every 60 seconds, it heartbeats state `attention` with reason `event_schema_outdated` in the checkout's private resident health store.

- **Host resident:** Its checkouts have no Node and therefore local reader inventory. Under invariant 10, installing or adopting a continuity policy consents to background knowledge on the host. Activation writes only untracked, Lervo-managed local data with a backup; the activation contract permits local-only activation when the local runtime is the only reader. The host resident performs hook reader preflight, backup, and exact plan apply itself. Blocked activation keeps the checkout held with the blocker code. Retry held checkouts at most every 30 minutes. Between retries, each scan reads only the writer coordinate, detecting activation elsewhere within one scan. Never perform distributed (Node and Hub) activation from the host resident.
- **Node resident:** A Node never activates its own writer; that requires the Hub-enabled procedure. Its resident child starts even with an outdated writer, holds with `event_schema_outdated`, rereads the coordinate every 60 seconds, and starts the ordinary resident once `lervo upgrade` selects schema 4. No Node restart is required. A Node without a child maintains an in-process hold beside its existing outcome-supervision loop.
- **Onboarding:** `lervo init` and `lervo repository register --write` perform the same local-only activation before continuity reconciliation, so new projects on hosts with active policies start at schema 4.

### Host resident status and lock

`knowledge-host-resident.json` in the user state directory is owner-only, at most 128 KiB, and rewritten after every scan and every 60 seconds.

- Required fields: `schemaVersion` (1), `pid`, `startedAt`, `heartbeatAt`, `launch` (`service | manual`), `role` (`active | standby`), and `repositories` (at most 256). Each repository has `repositoryRoot`, `state` (`serving | held | node_served | not_enrolled`), and `reason` and `detail` as closed codes or null.
- Privacy: include only absolute checkout roots already in the host registry and closed codes. Exclude messages, addresses, credentials, and provider output. The file never leaves the host and is rebuildable.
- Failure meaning: a heartbeat older than three minutes or a dead PID means no host resident runs. An unreadable file means unknown, never healthy.

`knowledge-host-resident.lock` identifies its holder's PID. Only the holder serves. A second host resident, such as a hand-written service alongside the managed service, stays `standby` and takes over when the holder exits. Replace a lock whose holder is gone. Per-repository worker locks and full-cycle admission remain the exclusivity authority for knowledge work; even a lost lock race cannot duplicate a cycle.

### Host resident service lifecycle

Add a `hostService` upgrade stage for the host's one host resident service. Apply only when at least one registered checkout has no Node and has a delegation or active continuity policy able to seed one. Continue skipping Node-served checkouts.

- Targets: `~/Library/LaunchAgents/com.lervo.knowledge.host.plist` (launchd `gui/<uid>`) and `~/.config/systemd/user/lervo-knowledge-host.service` (systemd user). The release-tested renderer and manager (`pnpm service:render`, `pnpm service:manage`) gain the `knowledge-host` runtime. Bind the exact Node executable and installed CLI entry point; run `knowledge worker --watch --host --config <path>`. Installation, exact-predecessor upgrade, compensation, and status retain ADR-0164 semantics; differing bytes are never overwritten.
- `knowledge-host/config.json` in the user state directory is owner-only and at most 16 KiB. It contains `schemaVersion` (1), `userStateDirectory`, and `provider` (null or a provider name). Create it once; never rewrite a valid file. Invalid configuration blocks with `host_service_config_invalid`.
- The plan exposes only the manager, service label, action (`install | activate | upgrade`), definition and configuration hashes, repository counts, and whether an unmanaged host resident runs. Include no paths. Apply re-plans, fails with `host_service_plan_stale` if anything changed, then runs the manager with `--write`. An unavailable manager, such as WSL without systemd, blocks with its remedy. Unsupported operating systems remain `pending_authority` (`service_manager_unsupported`).
- The installed CLI path changes each release. The next `lervo upgrade` reports `host_service_outdated` and transactionally replaces the service.

Emit no new event. As in ADR-0164, the service manager result is an observation, not readiness evidence.

### Service tool directories

Service managers start services without login shells. The renderer accepts `--path-directories <dir:dir>`, adding directories to service `PATH` after runtime directories and before fixed system directories. Without them, rendered bytes exactly match earlier releases.

The planner resolves tools against the planning shell's `PATH`, in order: each provider the service runs, `git`, then optional `gh`. Record the first directory containing each tool. Provider scope is:

- **Host resident service:** providers of every checkout it serves.
- **Repository Node:** providers of its knowledge resident (delegation or host policy) and outcome supervision.

Directories belong to the rendered definition and are bound by the reviewed plan hash. A missing provider or `git` blocks with `service_tool_unresolved`, naming the tool. The Node stage compares the full desired definition hash, not just the launcher path. A changed definition, including a hand-edited `PATH`, reports `node_service_definition_changed` and is replaced through exact-predecessor upgrade. `lervo repository node apply` resolves the same directories.

### Doctor

The doctor reads host resident status, the Node fleet, and each checkout's resident health:

| Code | Severity | Meaning |
| --- | --- | --- |
| `event_schema_outdated` | attention | Resident held; detail names the activation blocker |
| `continuity_pending` | info | Host resident serves this checkout but has not reconciled yet |
| `continuity_unobserved`, `resident_not_running` | attention | Detail `node_served` points to the Node; `host_resident_absent` points to `lervo upgrade`, which installs the host resident service |

Never advise a held or unserved checkout to "register a Node or run worker --watch" while a host resident serves it.

### Continuous integration

[ADR-0496](0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) supersedes the per-shard build and unconditional heavy-verification configuration below. It retains full source-change tests, shares exact build outputs, admits a conservative documentation-only path, and requires an aggregate result plus full manual/daily fallbacks.

The code-quality workflow adds two jobs for pull requests and `main`, on `ubuntu-latest` with Node 22.13.0:

- `release-artifacts`: `pnpm build`, `pnpm release:manifest:check`, and `pnpm release:sbom:check`.
- `test`: `pnpm build`, then `pnpm test`, sharded across four runners with two workers each, a 30-second default test deadline, and a 45-minute timeout per shard. A vitest setup file sets `LERVO_USER_STATE_DIRECTORY` to a per-process temporary directory so no test reads or writes a developer's real host registry, policy, or services.

## Failure meaning

- `event_writer_plan_stale` and `host_service_plan_stale`: inputs changed after planning; nothing in that stage was applied.
- `event_writer_backup_failed`: no activation occurred.
- `service_tool_unresolved`: a required provider or `git` is missing from the planning shell's `PATH`; the service stage was not applied.
- Held residents perform no knowledge work. Heartbeats prove only that a host process intends to serve the checkout and why it cannot.
- Writer activation errors retain event-contract meanings: `event_writer_recovery_required`, `event_writer_activation_blocked`, and reader inventory codes.

## Consequences

- One reviewed `lervo upgrade --apply` per host brings every local-only checkout to schema 4, installs or refreshes the host resident service, and leaves Hub-enabled checkouts current or blocked with exact remedies.
- New projects reach schema 4 at `lervo init`; the installed host resident serves them within one five-minute scan.
- The doctor and attention report every held or unserved checkout with its cause.

## Deferred

- Retiring hand-written host resident services: they remain installed and on standby until the owner removes them.
- Pruning release-specific CLI installation directories: a service whose CLI directory is removed before the next upgrade cannot start until `lervo upgrade` replaces it.

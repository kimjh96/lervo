# ADR-0575: Follow published releases on every host

Status: `accepted` (the host follower; Hub ordering, the Hub hint, and the Hub-wide pause are a later slice)
Decision date: 2026-11-17
Amends: [ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (Stage 3), [ADR-0164](../operations/services/0164-user-runtime-service-management-boundary.md) (a `host-follow` user service)
Related: [ADR-0569](../release/packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md), [ADR-0573](0573-restart-a-replica-coordinator-that-runs-a-superseded-runtime.md), [ADR-0574](0574-admit-upgrades-ahead-of-background-knowledge-cycles.md), [ADR-0214](../operations/services/0214-bounded-repository-upgrade-orchestration.md), [ADR-0488](../operations/services/0488-point-node-configurations-at-one-current-cli.md)

## Context

The owner's target is a released fix on every host in 10 to 15 minutes with no manual deploy step. After ADR-0571 Stage 1, an agent still runs `lervo host upgrade --from-release <tag> --repository kimjh96/lervo --apply` on each host. It then runs the deploy skill's `upgrade-all.sh` for every registered repository. Nothing happens until an agent starts, and its wait adds to the delivery time.

The same follower must run on every host. By owner rule, a cross-host conflict is solved by coordination and never by limiting a Lervo feature to one host. It must also work without a Hub, because local execution never depends on one.

## Decision

### Command surface

```text
lervo host upgrade --follow [--apply [--once]] [--repository <owner/name>] [--bin-directory <path>] [--json]
lervo host upgrade --follow --pause | --resume | --pin <tag> [--json]
lervo host upgrade --follow --status [--json]
lervo host upgrade --follow --service <install|remove> [--apply] [--repository <owner/name>] [--json]
```

Without `--apply`, `--follow` reads the release list, the links, and the follower files, and prints what the next cycle would do. It writes nothing. `--apply --once` runs one cycle under the follower lock. `--apply` alone runs cycles until the service manager stops it. `--service install` and `--service remove` print their plan without `--apply` and change the user service with it ([ADR-0164](../operations/services/0164-user-runtime-service-management-boundary.md)). `--pause`, `--resume`, and `--pin <tag>` take effect at once, because the owner's command is the only thing they record.

The followed repository is `--repository`, otherwise the follower configuration's coordinate, otherwise the repository this host last installed from. Every ADR-0571 release record names it (v0.24.0 and v0.24.1 already write it), and the follower state keeps the last checked coordinate in case those records rotated out. Without any, the follower refuses with `host_follow_repository_unknown` until `--repository` names it once. `package.json` is not used: its `repository` field belongs to the separate npm publication decision.

### One cycle

1. **Hand over first.** The cycle resolves the package the `lervo` link runs. If this process runs a different package, the follower points its runtime link at the active package and stops (see "Self-update").
2. **Honour a pause.** A paused host does nothing else, including repository upgrades.
3. **Finish a due repository pass.** A pass is due while the follower's own activation has not settled, and whenever the `lervo` link names a different CLI than the last pass ran. That covers the first cycle, a handover, a manual activation, and a rollback.
4. **Poll.** The follower lists the newest 30 releases through `gh release list`. It keeps published `v<major>.<minor>.<patch>` releases (not drafts or prereleases) and takes the newest version, so a host that missed several releases skips the ones in between. A pin replaces "newest" with the pinned tag. Nothing happens when that release is not newer than the active CLI; following never downgrades, and going back is `--rollback`. A tag recorded as failed on this host is never installed again by the follower, and no older release replaces it.
5. **Install.** The follower runs the ADR-0571 apply for that tag: published-only admission, verification against the tag, side-by-side install, the health gate, and an activation id. A release whose assets are not complete yet is a `waiting` outcome and is retried at the next poll.
6. **Upgrade repositories.** It runs `lervo upgrade` on every registered repository with the active CLI (see "Repository pass").

### Repository pass

The pass is the product form of `upgrade-all.sh`. For each repository in the host registry, one at a time, the follower runs `<bin>/lervo upgrade --root <path> --json`. It applies a `ready` plan with `--apply --approval <planId>` and falls back to `--apply --safe` on `upgrade_plan_changed`. Any other plan that is not `current` gets `--apply --safe`, and a `blocked` plan without independent stages is reported without an apply. It stops after five rounds. The follower starts the `lervo` link itself rather than calling upgrade code in its own process. A pass therefore always runs the CLI that is active now, in a fresh process, whatever version the follower runs.

Each repository ends as one of:

- `current`.
- `blocked`: repository content holds a stage, such as lint, a layout decision, or an owner approval (`upgrade_owner_approval_required`). It is reported and never rolls the host back.
- `failed`: another failure, a timeout after 90 minutes, or no convergence in five rounds. It is reported and does not roll the host back.
- `host_failure`: the new CLI does not run on this host. The Node it restarted did not become ready (`node_fleet_readiness_timeout`, `node_fleet_service_unavailable`, `node_fleet_recovery_failed`, or `node_fleet_apply_failed`), or `lervo upgrade` printed no readable result. A host failure stops the pass, because the remaining repositories would run the same CLI.

### Failure and rollback

A failed health gate already restores the links inside the ADR-0571 apply. The follower records the tag as failed with the restored activation id. Verification and install failures that recur for the same bytes also record the tag as failed. These are `release_subjects_*`, the download, install, closure, or installed-bytes conflicts, a failed link switch, and any unknown code. Transient failures do not mark the tag: the release source being unreachable, the installer failing, or a manual host upgrade holding the lock. They retry at the next poll. A user-owned file at a link path or a damaged journal is reported as `host_blocked`.

When the pass after the follower's own activation reports a host failure, the follower records the tag as failed first and then rolls the activation back by id with the ADR-0571 rollback. A crash between those steps can then never retry the tag. A second pass then converges every repository on the restored CLI. A host failure after a manual activation is reported but not rolled back, because the owner chose that CLI. A rollback that ADR-0571 refuses, for example because a newer activation moved the links, is reported as `rollback_failed`; the tag stays failed.

To retry a failed tag, the owner runs `lervo host upgrade --from-release <tag> --apply`. The follower then sees an active CLI that the last pass did not run and upgrades the repositories with it.

### Self-update

After an activation, the running follower is old code, and Node never reloads a running program. The old process stays in charge until the release is proven on this host. It runs the repository pass through the new `lervo` link, so the new CLI does the work while the old one judges it and can still roll it back. If the pass shows no host failure, the follower moves its runtime link to the new package and exits with code 75 (EX_TEMPFAIL). The service manager restarts only a failed exit (systemd `Restart=on-failure`, launchd `KeepAlive` with `SuccessfulExit` false), so the next process starts on the new package. A stop by the service manager exits 0 and stays stopped.

The handover is also checked at the start of every cycle. A manual activation or rollback therefore restarts the follower on the active CLI as well. A follower that crashed during its pass leaves `inFlight` in its state. The process that starts next, old or new, settles that activation and rolls it back by id on a host failure.

### Service

`--service install --apply` installs the `host-follow` user service through the release-tested renderer and manager. On Linux it is `~/.config/systemd/user/lervo-host-follow.service`; on macOS it is `~/Library/LaunchAgents/com.lervo.host.follow.plist`, logging to `~/Library/Logs/Lervo/host-follow.log`. The follower bounds that log at start, as ADR-0555 does for the host resident. The definition runs `<node> <cli>/host-follow-runtime/dist/bin.js host upgrade --follow --apply --config <cli>/host-follow-service.json`, where `<cli>` is the directory of the activation journal. The runtime link is a directory link to the active package root, like ADR-0488's `current` pointer, so the definition stays byte-identical across releases. Only the follower moves that link, and only to the package the `lervo` link already runs. Retention keeps the install it names. `current` stays with `lervo upgrade`, which moves Nodes.

A service manager starts the follower without a login shell. The configuration therefore keeps the installing shell's `PATH`, reduced to absolute entries, and the follower restores it at start. `gh`, `pnpm`, `git`, providers, and every `lervo upgrade` then resolve as they did in that shell, and repository upgrades plan the same service definitions as a manual run. Install refuses `host_follow_cli_missing` when no managed `lervo` link names an installed CLI.

### Timing

Every host polls every 5 minutes with its own random jitter of ±20%. Consecutive release-source failures double the base delay, up to 60 minutes; the first successful list resets it. A cycle that throws is logged and backs off the same way, so a damaged file never becomes a busy loop.

### Concurrency

- One follower per host: `<cli>/host-follow.lock` is the ADR-0571 PID lock, held for the whole service process or one `--once` run. A second follower fails with `host_follow_in_progress`.
- Installs and rollbacks take the ADR-0571 host upgrade lock as before. A manual `--from-release`, `--rollback`, or a second host upgrade holding it makes the follower's cycle `busy`, and it retries later. The follower does not hold that lock during the repository pass, so the owner can still roll back by hand meanwhile.
- The pass runs repositories one at a time. Each `lervo upgrade` keeps its own resident exclusion and priority admission (ADR-0484, ADR-0574).

### State, privacy, and failure meaning

The follower writes two files beside the activation journal, each with one writer, replaced atomically with mode 0600:

- `host-follow.json`, written by the follower under its lock: `schemaVersion` 1, `repository`, `lastCheckAt`, `lastSeenTag` (the newest published tag), `consecutiveSourceFailures`, `lastOutcome` (`at`, `outcome`, `tag`, `code`), `failedTags` (the newest 16 of `tag`, `failedAt`, `code`, `activationId`), `inFlight` (`tag`, `activationId`, `startedAt`), and `lastPass`. The `lastPass` record holds `cliTarget`, `version`, `finishedAt`, `outcome`, and per repository its `repositoryRoot`, `outcome`, `status`, `code`, `rounds`, `appliedStages`, and `pendingStages`.
- `host-follow-control.json`, written only by `--pause`, `--resume`, and `--pin`: `schemaVersion` 1, `paused`, `pinnedTag`, `changedAt`. `--resume` clears the pause and the pin.

Both hold local paths and public release coordinates only, never `gh` output. Each record is replaced, not appended. Failed tags have a fixed bound, and repository results are bounded by the host registry. The service configuration `host-follow-service.json` holds `repository` (null for the package default), `binDirectory`, and `searchPath`. The follower writes to repositories only through `lervo upgrade`. It never creates a tag or a release, and it emits no runtime event: the files are a bounded projection, and the activation journal and `lervo upgrade` receipts keep their own evidence.

Cycle outcomes: `paused`, `handover`, `current`, `no_published_release`, `release_failed_on_host`, `pinned_release_unavailable`, `pinned_release_reached`, `source_unavailable`, `waiting`, `busy`, `install_retry`, `host_blocked`, `release_failed`, `rolled_back`, `rollback_failed`, `upgraded`, and `repositories_upgraded`. A `--once` run exits 1 for `host_blocked`, `release_failed`, `rolled_back`, and `rollback_failed`.

Failure codes:

- `host_follow_in_progress`: another follower holds this host's follower lock; nothing changed.
- `host_follow_state_invalid`, `host_follow_control_invalid`: a follower file is unreadable. It is left untouched, and the follower changes nothing until the file is repaired or removed.
- `host_follow_config_invalid`: the service configuration is missing or malformed; reinstall the service.
- `host_follow_repository_unknown`: no `--repository`, configuration, journal release record, or follower state names the coordinate. Service install reports it as a blocker.
- `host_follow_cli_missing`: service install found no managed `lervo` link to run.
- `host_follow_service_unavailable`: the installed service did not stay active.
- `host_follow_repository_upgrade_unreadable`, `host_follow_repository_upgrade_timeout`, `host_follow_repository_upgrade_unconverged`, `upgrade_plan_blocked`: per-repository codes in `lastPass`.

### Owner decisions recorded

- The poll interval is 5 minutes with ±20% per-host jitter, plus backoff on release-source failures.
- The follower installs only the newest published release and skips the ones in between.
- The default repository coordinate is the one this host last installed from; `--repository` overrides it and is needed once on a host without a recorded install.
- Pause and pin are per host now (`--pause`, `--resume`, `--pin <tag>`). The Hub-wide pause, and whether it needs its own Node credential scope, belong to the Hub slice.

### Later slice

The Hub slice adds a Hub hint that only triggers an earlier poll, Hub-first ordering with the Hub archive as a verified subject, other hosts waiting until `/v1/health/capabilities` lists the release's readable schema versions, and a Hub-wide pause. None of them changes how a host installs, verifies, rolls back, or upgrades repositories.

## Where it lands

This slice lands on `main`, like ADR-0571 Stages 1 and 2. It needs no Hub and no `core-loop` upgrade stage, and release speed is the owner's priority. The Hub slice still waits for `core-loop` integration.

## Consequences

Once the service is installed, a host needs no agent action for a release. Publication to an installed CLI takes at most one poll interval (6 minutes with jitter) plus the install time. A broken release stops on each host at its own health gate or Node readiness and is never retried there. Without Hub ordering, a follower can install a release before the Hub serves its schema versions. `lervo upgrade` already defers event-writer activation until every reader supports a version, so that order costs time, not correctness. The manual deploy path stays as the fallback, for example for the Hub itself.

## Verification

All tests use temporary homes and fakes for GitHub, the service manager, and repository upgrades. `apps/cli/test/host-follow-cycle.test.ts` covers newest-only install with handover, the same-version no-op, a failed health gate never retried, a Node readiness rollback by id with a converging pass, content blocks, pause and pin, source backoff, a manual activation, an activation left in flight, and a held host upgrade lock. `host-follow-command.test.ts` covers the plan, a cycle with no Hub configured, pause, pin, resume, status, lock contention, service install and removal, arguments, the recorded coordinate, and the loop's jitter, backoff, handover exit, and stop. `host-follow-policy.test.ts` and `host-repository-pass.test.ts` cover the decisions, the pass, and the runner. `runtime-service-render.test.mjs` and `runtime-service-management.test.mjs` cover the `host-follow` definition and an install through the runtime link.

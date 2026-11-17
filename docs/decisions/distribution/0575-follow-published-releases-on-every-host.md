# ADR-0575: Follow published releases on every host

Status: `accepted` (the host follower; Hub ordering, the Hub hint, and the Hub-wide pause are a later slice)
Decision date: 2026-11-17
Amends: [ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (Stage 3; pruning after activation is best-effort), [ADR-0164](../operations/services/0164-user-runtime-service-management-boundary.md) (a `host-follow` user service)
Amended by: [ADR-0577](0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md) (the launchd follower runs as `Standard`), [ADR-0582](0582-reuse-one-repository-scan-across-an-upgrade-command.md) (no `--safe` apply that the plan shows would refuse)
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

1. **Settle the follower's own release first.** Before installing, the follower writes an intent (`inFlight`) naming the tag. Until a repository pass proves the release on this host, every later cycle, in whichever process, settles that intent before anything else, including a handover. The intent holds the activation id the follower chose before the install and handed to it, and only the journal record with exactly that id is the follower's own. A manual activation of the same tag is therefore never adopted. A record a crash left `pending` is reconciled by ADR-0571 under the host upgrade lock before the intent is abandoned.
2. **Hand over.** If this process runs a different package than the `lervo` link, the follower points its runtime link at the active package and stops (see "Self-update and stop").
3. **Honour a pause.** A paused host does nothing else, including repository upgrades.
4. **Upgrade repositories for a new CLI.** A pass is due whenever the `lervo` link names a different CLI than the last pass ran: the first cycle, a handover, a manual activation, or a rollback.
5. **Poll.** The follower lists the newest 30 releases through `gh release list`. It keeps published `v<major>.<minor>.<patch>` releases (not drafts or prereleases) and takes the newest version, so a host that missed several releases skips the ones in between. A pin replaces "newest" with the pinned tag. Nothing happens when that release is not newer than the active CLI; following never downgrades, and going back is `--rollback`. A tag recorded as failed on this host is never installed again by the follower, and no older release replaces it.
6. **Install** through the ADR-0571 apply (published-only admission, verification, side-by-side install, health gate, activation id), then settle as in step 1. Otherwise, **retry** the repositories whose retry is due.

### Repository pass

The pass is the product form of `upgrade-all.sh`. For each registered repository, one at a time, the follower runs `<bin>/lervo upgrade --root <path> --json`. It applies a `ready` plan with `--apply --approval <planId>` and falls back to `--apply --safe` on `upgrade_plan_changed`. Any other plan that is not `current` gets `--apply --safe`. A failed apply of a `ready` plan, such as `knowledge_cycle_admission_wait_expired`, goes on to the next round as the script does, for at most five rounds. The follower starts the `lervo` link itself, so a pass always runs the active CLI in a fresh process.

A repository ends `current`, `blocked` (content holds a stage: lint, a layout decision, or `upgrade_owner_approval_required`), `failed` (anything else, a 90-minute timeout, or no convergence), or `host_failure`. Host failures are the Node readiness codes `node_fleet_readiness_timeout`, `node_fleet_service_unavailable`, `node_fleet_recovery_failed`, and `node_fleet_apply_failed`, and a run that exits without a JSON result. A host failure is believed only when it repeats in a second round of the same repository. Readiness can time out for reasons of the moment, such as a slow disk or a port still held, and the Node stage restores its previous service before it reports. One more round is therefore safe, while a release that breaks Node fails twice. A believed host failure stops the pass.

Failed repositories are retried with the same CLI after 10, 20, and 40 minutes, then wait for another CLI. A blocked repository is planned again hourly and applied only when its plan id changed, so a block that needs the owner costs one plan per hour. Host failures are not retried. Known gap: a release whose apply throws a plain error in every repository reports `command_failed`, which is `failed`, not a host failure, so that release is kept.

### Failure and rollback

A failed health gate already restores the links inside the ADR-0571 apply; the follower records the tag as failed with the restored activation id. Verification failures, conflicts, a failed link switch, and unknown codes also fail the tag. An installer failure (`host_upgrade_install_failed`) or an abandoned install (`host_follow_install_abandoned`) backs off, and the third in a row fails the tag. An unreachable release source and a held host upgrade lock retry at the next poll without counting. A user-owned file at a link path or a damaged journal is `host_blocked`. After the links switched, pruning old installs is best-effort, so a housekeeping error never reports a healthy release as failed.

When the follower's own release meets a believed host failure, the follower records the tag as failed and the rollback as pending, and then rolls the activation back by id. A crash in between never retries the tag and still finishes the rollback. A rollback that meets the host upgrade lock stays pending and is retried next cycle (`rollback_pending`). A rollback record that already names the activation counts as done, so a crash after the rollback still runs the converging pass. Only a rollback ADR-0571 refuses for good, such as `host_upgrade_rollback_superseded`, ends the intent (`rollback_failed`). A pass on the restored CLI then converges every repository. A host failure after a manual activation is reported, not rolled back, because the owner chose that CLI. To retry a failed tag, the owner runs `lervo host upgrade --from-release <tag> --apply`.

### Self-update and stop

After an activation, the running follower is old code, and Node never reloads a running program. The old process stays in charge until the release is proven: it runs the pass through the new `lervo` link and can still roll it back. Then it moves its runtime link to the new package and exits with code 75 (EX_TEMPFAIL). The service restarts only a failed exit (systemd `Restart=on-failure`, launchd `KeepAlive` without `SuccessfulExit`), so the next process starts on the new package. A manual activation or rollback also triggers the handover.

A stop request (service stop or remove, logout, shutdown) reaches the follower as SIGTERM. The follower aborts its cycle: the running `lervo upgrade` child is stopped and reports `interrupted`, never a host failure. The intent is kept, nothing is settled, and the follower exits 0, so the service manager leaves it stopped. The next start resumes the pass. systemd also signals the child through the unit's cgroup. launchd sends SIGTERM to the job and, when the job exits, kills what remains of its process group, because the definition does not set `AbandonProcessGroup`. A child that dies from a signal the follower did not send, such as the OOM killer's, is also `interrupted`. That pass is retried, and only the third such pass of one intent counts as a host failure (`host_follow_repository_upgrade_interrupted`).

### Service, state, and concurrency

`--service install --apply` installs the `host-follow` user service through the release-tested renderer and manager. Its definition runs `<node> <cli>/host-follow-runtime/dist/bin.js host upgrade --follow --apply --config <cli>/host-follow-service.json`. The runtime link is a directory link to the active package root, so the definition stays byte-identical across releases. The configuration keeps the installing shell's `PATH`, which the follower restores. One follower runs per host under its own lock. Installs and rollbacks take the ADR-0571 host upgrade lock, which the follower does not hold during a pass. The [host release follower contract](../../distribution/host-release-follower.md) defines the service paths, the state and control files with their fields and privacy, the cycle outcomes, and the failure codes. The follower writes to repositories only through `lervo upgrade`, never creates a tag or release, and emits no runtime event.

### Timing and measurement

Every host polls every 5 minutes with its own random jitter of ±20%. Each backoff level (consecutive release-source failures or installer failures) doubles the base delay, up to 60 minutes. A cycle that throws backs off the same way.

`lervo upgrade --apply` receipts now carry `timing` (`admissionWaitMs`, `applyMs`), and the pass records `waitMs`, `applyMs`, and `elapsedMs` per repository. They decide a follow-up the review proposed: a yield-only pass marker for the whole repository pass. Admission ordering would ignore it, it would be bounded, and it would be released when a resident has waited about 15 minutes. It is not implemented.

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

All tests use temporary homes and fakes for GitHub, the service manager, and repository upgrades. `apps/cli/test/host-follow-cycle.test.ts` covers newest-only install with handover, the no-op, a failed health gate, a readiness rollback, content blocks, pause and pin, backoff, a manual activation, settling an intent before a handover, an intent matched through the journal, best-effort pruning, a rollback retried after the lock, install backoff, interruptions, and retries. `host-follow-command.test.ts` covers the command, service, lock contention, and the loop. `host-follow-policy.test.ts` and `host-repository-pass.test.ts` cover the decisions, the rounds, and the runner, including a signal-killed and an aborted child. The renderer and manager tests cover the `host-follow` definition.

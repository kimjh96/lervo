# Host release follower contract

This document defines the files, outcomes, and failure codes of `lervo host upgrade --follow`. [ADR-0575](../decisions/distribution/0575-follow-published-releases-on-every-host.md) records the decisions behind them. `<cli>` below is the directory of the ADR-0571 activation journal.

## Service

- Linux: `~/.config/systemd/user/lervo-host-follow.service`, logging to the user journal.
- macOS: `~/Library/LaunchAgents/com.lervo.host.follow.plist`, logging to `~/Library/Logs/Lervo/host-follow.log`. The follower bounds that log at start, as ADR-0555 does for the host resident. Its `ProcessType` is `Standard`, so the upgrades it runs are not throttled as background work ([ADR-0577](../decisions/distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md)). The other Lervo services keep `Background`.
- `--follow --status` and the follow plan report `serviceDefinition`: `current`; `node_changed` when the installed bytes match once the Node path they name is substituted, so only the shell's Node differs; `definition_outdated` when they still differ; `not_installed`; or null when unreadable. The follower never replaces its own service, because that would stop its running `lervo upgrade`. The owner reruns `--service install --apply` while no pass is in flight.
- The definition runs `<node> <cli>/host-follow-runtime/dist/bin.js host upgrade --follow --apply --config <cli>/host-follow-service.json`. Only the follower moves `host-follow-runtime`, and only to the package the `lervo` link already runs. Retention keeps the install it names. ADR-0488's `current` pointer stays with `lervo upgrade`.
- `host-follow-service.json` holds `repository`, `binDirectory`, and `searchPath`. A null `repository` means the repository this host last installed from. `searchPath` is the installing shell's `PATH`, reduced to absolute entries.
- Install refuses `host_follow_cli_missing` without a managed `lervo` link, and `host_follow_repository_unknown` when neither `--repository` nor a recorded install names the coordinate.

## State files

The follower writes two files in `<cli>`. Each has one writer and is replaced atomically with mode 0600. Both hold local paths and public release coordinates only, never `gh` output, and each record is replaced rather than appended.

`host-follow.json` is written by the follower under its lock, with `schemaVersion` 1 and these fields:

- `repository`, `lastCheckAt`, and `lastSeenTag` (the newest published tag seen).
- `consecutiveSourceFailures`: release-source failures in a row.
- `lastOutcome`: `at`, `outcome`, `tag`, and `code`.
- `failedTags`: the newest 16 entries of `tag`, `failedAt`, `code`, and `activationId`.
- `inFlight`: the intent written before an install, with `tag`, `activationId` (chosen before the install and given to it), `startedAt`, `rollback` (`code` while a rollback waits), and `interruptions`.
- `installFailures`: `tag`, `count`, and `code` of consecutive installer failures and abandoned installs (`host_follow_install_abandoned`). The tag fails at the third.
- `lastPass`: `cliTarget`, `version`, `finishedAt`, `outcome`, and one entry per repository. Each entry holds `repositoryRoot`, `outcome`, `status`, `code`, `rounds`, `appliedStages`, `pendingStages`, `planId`, `attempts`, `nextAttemptAt`, `waitMs`, `applyMs`, `elapsedMs`, and `stageTimings`. `waitMs` and `applyMs` are null when no receipt carried `timing`. `stageTimings` lists, for each round, the plan command's wall time as `plan_command` and then the apply receipt's parts, each as `round`, `stage`, and `ms` ([ADR-0579](../decisions/distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)). Passes of earlier CLIs have no `stageTimings`.

`host-follow-control.json` is written only by `--pause`, `--resume`, and `--pin`. It holds `schemaVersion` 1, `paused`, `pinnedTag`, and `changedAt`. `--resume` clears both the pause and the pin.

Failed tags have a fixed bound, and repository entries are bounded by the host registry. The activation journal and the `lervo upgrade` receipts keep their own evidence, so the follower emits no runtime event.

## Cycle outcomes

- Holding: `paused`, `handover`, `interrupted`, `busy`, `waiting`, and `host_blocked`.
- Nothing to install: `current`, `no_published_release`, `release_failed_on_host`, `pinned_release_unavailable`, and `pinned_release_reached`.
- Retrying: `source_unavailable` and `install_retry`.
- Settling an intent: `install_abandoned` (no active record has the intent's activation id, after any pending one was reconciled) and `in_flight_superseded` (the links moved elsewhere since).
- Results: `release_failed`, `upgraded`, `rolled_back`, `rollback_pending`, `rollback_failed`, `repositories_upgraded`, and `repositories_retried`.

A `--once` run exits 1 for `host_blocked`, `release_failed`, `rolled_back`, `rollback_pending`, and `rollback_failed`. The service loop exits 75 after a handover and 0 after a stop request.

## Failure codes

- `host_follow_in_progress`: another follower holds this host's follower lock; nothing changed.
- `host_follow_state_invalid`, `host_follow_control_invalid`: a follower file is unreadable. It is left untouched, and the follower changes nothing until the file is repaired or removed.
- `host_follow_config_invalid`: the service configuration is missing or malformed; reinstall the service.
- `host_follow_repository_unknown`: no `--repository`, configuration, journal release record, or follower state names the coordinate.
- `host_follow_cli_missing`: service install found no managed `lervo` link to run.
- `host_follow_service_unavailable`: the installed service did not stay active.
- `host_follow_install_abandoned`: an install of the tag left no active record of its own, for example after a crash whose pending record was restored; the third in a row fails the tag.
- `host_follow_repository_upgrade_interrupted`: a third `lervo upgrade` of one intent died from a signal the follower did not send; the follower treats it as a host failure.

Repository entries in `lastPass` can also carry these codes:

- `host_follow_repository_upgrade_unreadable`: the run exited without a JSON result.
- `host_follow_repository_upgrade_timeout`: the run hit the 90-minute bound.
- `host_follow_repository_upgrade_unconverged`: five rounds did not converge.
- `upgrade_plan_blocked`: the plan is blocked with no independent stage to apply.
- `upgrade_plan_unchanged`: a blocked repository's plan id did not change since the last pass.
- `upgrade_owner_approval_required`: the plan has a stage waiting for owner approval, so `lervo upgrade --apply --safe` would refuse. The follower records this from the plan alone and does not run the apply; `pendingStages` names those stages ([ADR-0582](../decisions/distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md)).

They also carry the codes `lervo upgrade` itself reports. `knowledge_cycle_admission_lost` (ADR-0577) means the upgrade lost the host's full-cycle admission, and `knowledge_cycle_admission_unconfirmed` that lock contention kept it from confirming the admission. Their `phase` says whether the upgrade stopped before a stage or after the last one. Both are `failed` and retried, never a host failure.

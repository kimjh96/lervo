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
- `failedTags`: the newest 16 entries of `tag`, `failedAt`, `code`, and `activationId`. An entry may also carry `failure`: the `repositoryRoot` whose failure rolled the release back, and the bounded detail of that repository's failed command ([ADR-0575](../decisions/distribution/0575-follow-published-releases-on-every-host.md)). That detail is `readiness` (`baseline`, `lastStatus`, `lastProcessId`, `observations`, and at most eight `blockers` of `component`, `observed`, and `baseline` component states), `failedCode`, `recovery`, and `recoveryFailureCode`. It never holds a message or free text.

The follower keeps running the CLI it started with until a release proves itself, so a failed release's detail in `failedTags` is parsed by the old CLI and may be absent. The failing CLI therefore records its own: the Node stage of `lervo upgrade --apply` writes `.lervo/state/upgrade/node-failure.json` in the repository (`schemaVersion`, `failedAt`, `cliVersion`, `code`, and the same bounded `failure` detail). The next failure replaces it and the next successful Node stage removes it, so it holds one record at most.

- `inFlight`: the intent written before an install, with `tag`, `activationId` (chosen before the install and given to it), `startedAt`, `rollback` (`code` while a rollback waits), and `interruptions`.
- `installFailures`: `tag`, `count`, and `code` of consecutive installer failures and abandoned installs (`host_follow_install_abandoned`). The tag fails at the third.
- `lastPass`: `cliTarget`, `version`, `finishedAt`, `outcome`, and one entry per repository. Each entry holds `repositoryRoot`, `outcome`, `status`, `code`, `rounds`, `appliedStages`, `pendingStages`, `planId`, `attempts`, `nextAttemptAt`, `waitMs`, `applyMs`, `elapsedMs`, `stageTimings`, and, after a failed command that reported one, the same bounded `failure` detail without `repositoryRoot`. `waitMs` and `applyMs` are null when no receipt carried `timing`. `stageTimings` lists, for each round, the plan command's wall time as `plan_command` and then the apply receipt's parts, each as `round`, `stage`, and `ms` ([ADR-0579](../decisions/distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)). An apply that returned no receipt parts, such as a failure, is one part of its own, `apply_command` ([ADR-0589](../decisions/distribution/0589-shorten-the-follower-path-from-publication-to-the-last-repository.md)); passes of earlier CLIs can also show `safe_apply_command`. Passes of earlier CLIs have no `stageTimings`. Each round runs `lervo upgrade --json`, then `lervo upgrade --apply --json`, which plans again inside its exclusive window; no stage waits for an owner approval ([ADR-0561](../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)). A repository left with `upgrade_lervo_debt` runs after the other repositories of every pass and keeps the hourly recheck, because Lervo clears its own debt once a provider is admitted or the held plan changes.

`host-follow-control.json` is written only by `--pause`, `--resume`, and `--pin`. It holds `schemaVersion` 1, `paused`, `pinnedTag`, and `changedAt`. `--resume` clears both the pause and the pin.

Failed tags have a fixed bound, and repository entries are bounded by the host registry. The activation journal and the `lervo upgrade` receipts keep their own evidence, so the follower emits no runtime event.

## Cycle outcomes

- Holding: `paused`, `handover`, `interrupted`, `busy`, `waiting`, and `host_blocked`.
- Nothing to install: `current`, `no_published_release`, `release_failed_on_host`, `pinned_release_unavailable`, and `pinned_release_reached`.
- Retrying: `source_unavailable` and `install_retry`.
- Settling an intent: `install_abandoned` (no active record has the intent's activation id, after any pending one was reconciled) and `in_flight_superseded` (the links moved elsewhere since).
- Results: `release_failed`, `upgraded`, `rolled_back`, `rollback_pending`, `rollback_failed`, `repositories_upgraded`, and `repositories_retried`.

A retry pass, or a pass for a CLI that no follower activation owns, checks between repositories whether a newer release is installable. It reuses the cycle's listing and lists again at most once per repository boundary and once a minute. A newer release stops the pass at that boundary, and the same cycle installs it, unless the last cycle left that tag's install `waiting`, `host_blocked`, `busy`, `install_retry`, or `install_abandoned`, which the poll retries; so does a release found when such a pass ends. The cycle result then reports the install, and `precededBy` names the pass before it (`outcome`, and `yielded` when the release stopped it). The service log line carries `precededBy` only when it is set ([ADR-0589](../decisions/distribution/0589-shorten-the-follower-path-from-publication-to-the-last-repository.md)).

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
- `repository_owner_hold`: the owner holds the repository with `lervo repository hold`, so the follower runs no upgrade command there; `rounds` is 0. It runs last in a pass and is rechecked hourly. `--follow --status` lists every hold on the host ([ADR-0561](../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).
- `upgrade_lervo_debt`: the plan or the apply's receipt has the status `lervo_debt`: Lervo holds a stage itself, such as a reviewed plan whose cross-check disagreed or had no admitted provider. `pendingStages` names those stages. It is a block, not owner work ([ADR-0561](../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)). Passes of earlier CLIs can still show `upgrade_owner_approval_required`.

They also carry the codes `lervo upgrade` itself reports. `knowledge_cycle_admission_lost` (ADR-0577) means the upgrade lost the host's full-cycle admission, and `knowledge_cycle_admission_unconfirmed` that lock contention kept it from confirming the admission. Their `phase` says whether the upgrade stopped before a stage or after the last one. Both are `failed` and retried, never a host failure.

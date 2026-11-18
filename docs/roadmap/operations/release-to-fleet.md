# Release to fleet without a manual deploy

Status: `active`
As of: 2026-11-17

## Outcome

A fix reaches every host in 10 to 15 minutes with no manual deploy step: published release, Hub, every host's CLI, knowledge host services, and every registered repository. Decisions: [ADR-0564](../../decisions/operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (S1), [ADR-0569](../../decisions/release/packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (S2), [ADR-0571](../../decisions/distribution/0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (host install, S3, S4), [ADR-0574](../../decisions/distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (S3 priority admission), [ADR-0575](../../decisions/distribution/0575-follow-published-releases-on-every-host.md) (S4 host follower), [ADR-0578](../../decisions/distribution/0578-plan-the-upgrade-knowledge-stage-from-one-scan.md) (S3 knowledge stage from one scan), and [ADR-0582](../../decisions/distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md) (S3 one scan per upgrade command).

## Baseline

v0.23.7 on 2026-11-14 (measured from release and receipt timestamps): merge to published release 14.7 minutes, publication to the last current repository 35.6, merge to fleet 50.3. Repository upgrades set the critical path: Mac 22.3 minutes for 9 repositories, WSL 34.2 for 7, with 7 of 16 runs waiting for a running background knowledge cycle.

## Measured: v0.25.1 on WSL

On 2026-11-17 the host follower upgraded WSL's six repositories serially in 28.7 minutes with no agent action. Five applies changed only `repository_node`. The breakdown comes from the follower's `lastPass`, the systemd journal of each Node unit, and the fleet registry's `updatedAt`; seconds, accurate to about one second ([ADR-0579](../../decisions/distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)).

| Repository | Plan command | Admission wait | Apply to stop | Stop to start | Start to registration | Registration to end | Apply total |
| ---------- | -----------: | -------------: | ------------: | ------------: | --------------------: | ------------------: | ----------: |
| axli       |           26 |            300 |            52 |           2.3 |                    76 |                  36 |         166 |
| plen       |           17 |              2 |            44 |           1.7 |                   3.1 |                  24 |          73 |
| flemo      |           24 |              0 |            56 |           1.7 |                   4.1 |                  35 |          97 |
| digimon    |           23 |             46 |            55 |           1.8 |                   3.1 |                  38 |          98 |
| shiflo     |           28 |              0 |            70 |           1.9 |                    15 |                  43 |         130 |
| lervo      |          123 |             46 |           265 |           2.1 |                    33 |                 184 |         484 |

Stopping and starting a Node worker took about 2 seconds, and readiness 3 to 4 seconds on most repositories. Most of the time went to repeated observation in the plan command, the plan recreated inside the exclusion, the stage inspections, and the final plan. Measured per call on WSL against plen-sized repositories: knowledge inspection 8 to 9 seconds, knowledge lint 4 to 5, describing the bundled Node runtime 1.2 to 2.7 (7 cold, nine times per repository), and the runtime retention inventory 1.5 to 3.3. ADR-0579 describes the runtime once per command, an estimated 8 to 19 seconds per repository and 50 to 115 seconds per WSL pass. Knowledge inspection, four runs per repository, is the largest remaining repeated cost. On `lervo` one inspection took about 112 seconds, because it scanned the repository up to 7 times; ADR-0578 keeps the four runs and makes each scan once, about 35 seconds.

## Stages

1. **Host install from the verified release (main).** `lervo host upgrade --from-release <tag>` per ADR-0571 Stage 1.
   - [x] Implemented with tests on branch `host-upgrade-follow`.
   - [ ] Released, and `lervo host upgrade --from-release v<first ADR-0569 release> --repository kimjh96/lervo` plans successfully on every host; the deploy skill then uses it instead of packing and relinking.
   - [ ] Release subjects carry integrity for the dependency closure, so hosts verify bytes and not only versions.
2. **S3: priority upgrade admission and stale-runtime restart (main).** S3 lands on `main`, not `core-loop`: release speed is the owner's priority, and `core-loop` integration has no date.
   - [x] An upgrade asks for full-cycle admission with priority; a running cycle yields at its next stage boundary, and waiting residents queue behind the upgrade. `knowledge_cycle_admission_wait_expired` stays as the backstop. Implemented on `main` by [ADR-0574](../../decisions/distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md); the installed measurement is still pending.
   - [ ] Knowledge materialization that an upgrade only schedules runs as the next normal cycle after release (amends ADR-0214; needs its own decision). Held: ADR-0574 records why moving it now would leave non-owner hosts and parked convergence with stale knowledge reported as current. Narrowed by ADR-0578 to releases that change compiler output, or repositories with many unmaterialized source changes; on v0.25.1 the stage applied nothing.
   - [x] Each knowledge inspection plans every migration stage from one repository scan instead of up to 7. Implemented by [ADR-0578](../../decisions/distribution/0578-plan-the-upgrade-knowledge-stage-from-one-scan.md). Plan-only on a copy of the WSL `lervo` repository: `lervo upgrade` 125 to 35 seconds.
   - [x] Measured on an installed release: on v0.25.3 the first WSL `lervo` round applied in about 236 seconds, against the estimated 220 and 484 before; with a second round the apply took 423 seconds ([ADR-0582](../../decisions/distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md)).
   - [x] Knowledge lint, every inspection, and the plans of one `lervo upgrade` command reuse one repository scan while a fingerprint of everything it read still holds; an edit during the run is still read by the next inspection. The `--safe` apply that a plan shows would refuse for owner approval is no longer run by the follower. Baseline on a copy of WSL `lervo`: an unchanged apply took 185 seconds with 7 scans; the after numbers come from the next follower pass ([ADR-0582](../../decisions/distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md)).
   - [ ] Measured on an installed release: the next follower pass after the release that carries ADR-0582 reports the `lervo` apply on WSL and the `argo` and `axli` applies on the Mac.
   - [ ] Evidence collection (about 4.4 seconds per inspection and lint on `lervo`) is reused within one upgrade command, keyed on an exact event-store high-water mark, with a test that an event appended during the upgrade is still read.
   - [ ] The Node onboarding receipt records when each readiness component was first accepted, so a slow `node_readiness` (76 seconds for WSL `axli` on v0.25.1 and v0.25.3) names its component.
   - [x] A replica whose process has no binding in the current runtime is restarted and reported as `repository_replica_service_stale_runtime`. Implemented on `main` by [ADR-0573](../../decisions/distribution/0573-restart-a-replica-coordinator-that-runs-a-superseded-runtime.md) (PR #259).
   - [ ] Measured on an installed release: no repository upgrade prints the admission wait, and publication to the last current repository is at most 12 minutes.
   - [x] An upgrade whose event loop stalls past its lease no longer runs on without the exclusion: it holds a 2-hour lease, confirms it before each consequential stage, and fails with `knowledge_cycle_admission_lost` once a resident took the slot. The launchd follower runs as `Standard`. Implemented by [ADR-0577](../../decisions/distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md).
   - [ ] After the release that carries ADR-0577, the follower is reinstalled on the Mac and its next argo apply is measured.
   - [x] A background provider call no longer holds an upgrade for its whole timeout: convergence, freshness, and change-review calls do not start while an upgrade waits and are cancelled within a second once one does. On v0.25.4, a 600-second normalization generation call held WSL `lervo` for 703 seconds. Implemented by [ADR-0587](../../decisions/distribution/0587-abandon-a-background-provider-call-for-a-waiting-upgrade.md).
   - [ ] After the release that carries ADR-0587, the next follower pass records the `waitMs` of WSL `lervo` and Mac `axli`; the target is at most about 2 minutes.
   - [x] One upgrade command describes the bundled Node runtime once instead of up to seven times in the apply and nine per repository, and `lervo upgrade --apply` receipts and follower pass entries carry `stageTimings` ([ADR-0579](../../decisions/distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)).
   - [x] After the release that carries ADR-0579, the next follower pass on WSL and the Mac reports `stageTimings`; the v0.25.3 breakdown is recorded in ADR-0582.
   - [x] Runtime retention reads the `--config` of every rendered Lervo service, so the follower, host resident, and replica units on systemd and launchd no longer make every plan report `runtime_references_unavailable`. Systemd drop-ins are read too: every runtime they name stays protected, and one that sets `ExecStart=` or `--config` defers retention, as does a definition that names `--config` in another shape or a missing configuration. Node onboarding and rollback no longer retire runtimes; only the planned runtime retention stage of `lervo upgrade` does, so a superseded runtime goes at the next upgrade. A read-only plan on WSL now proposes 2 of 6 runtimes (about 694 MB); all four Mac launchd definitions parse ([ADR-0579](../../decisions/distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)).
   - [ ] The runtime retention inventory walks only trees that can become retirement candidates.
3. **S4: `lervo host upgrade --follow`.** The host follower lands on `main` ([ADR-0575](../../decisions/distribution/0575-follow-published-releases-on-every-host.md)); Hub ordering waits for core-loop integration.
   - [ ] The Hub archive is a release subject verified like the CLI tarball.
   - [x] Every host polls GitHub Releases every 5 minutes with ±20% jitter and backoff, and following works with no Hub configured. Implemented by ADR-0575 as the `host-follow` user service on systemd and launchd.
   - [ ] A Hub hint triggers an earlier poll.
   - [ ] The Hub host upgrades the Hub first; other hosts wait until `/v1/health/capabilities` lists the release's readable schema versions.
   - [x] A host whose health gate or Node readiness fails rolls back its activation by id and does not retry that tag; repository content blocks are reported, not rolled back (ADR-0575).
   - [x] `--pause`, `--resume`, and `--pin <tag>` hold following on one host; only published releases are ever installed, and the follower never creates tags or releases (ADR-0575).
   - [ ] A Hub-wide pause holds following on every host.
   - [ ] Measured: publication to the last current repository on every host is at most 10 minutes with no agent action.

## Projected times

Estimated except the baseline: after Stage 1, about 33 minutes from publication to fleet; after S3, about 10 to 12; after S4, about 8 to 10, with merge to publication about 3.5 after ADR-0569. Fix to fleet also includes PR verification, 23.1 minutes on v0.23.7, tracked in [CI cost and duration](ci-cost-and-duration.md).

## Open owner decisions

- Decided (ADR-0575): the follow poll interval is 5 minutes with ±20% per-host jitter, plus backoff on GitHub failures.
- Decided (ADR-0575): `--follow` installs only the newest published release and skips the ones in between.
- Decided (ADR-0575): the default repository coordinate is the one this host last installed from, as its ADR-0571 activation journal records it; `--repository` overrides it and is needed once on a host without a recorded install.
- Decided (ADR-0575): pause and pin are per host now; the Hub-wide pause is part of the Hub slice.
- Open: whether a Hub-wide pause needs its own Node credential scope.

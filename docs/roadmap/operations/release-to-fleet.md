# Release to fleet without a manual deploy

Status: `active`
As of: 2026-11-17

## Outcome

A fix reaches every host in 10 to 15 minutes with no manual deploy step: published release, Hub, every host's CLI, knowledge host services, and every registered repository. Decisions: [ADR-0564](../../decisions/operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (S1), [ADR-0569](../../decisions/release/packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (S2), [ADR-0571](../../decisions/distribution/0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (host install, S3, S4), [ADR-0574](../../decisions/distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (S3 priority admission), and [ADR-0575](../../decisions/distribution/0575-follow-published-releases-on-every-host.md) (S4 host follower).

## Baseline

v0.23.7 on 2026-11-14 (measured from release and receipt timestamps): merge to published release 14.7 minutes, publication to the last current repository 35.6, merge to fleet 50.3. Repository upgrades set the critical path: Mac 22.3 minutes for 9 repositories, WSL 34.2 for 7, with 7 of 16 runs waiting for a running background knowledge cycle.

## Stages

1. **Host install from the verified release (main).** `lervo host upgrade --from-release <tag>` per ADR-0571 Stage 1.
   - [x] Implemented with tests on branch `host-upgrade-follow`.
   - [ ] Released, and `lervo host upgrade --from-release v<first ADR-0569 release> --repository kimjh96/lervo` plans successfully on every host; the deploy skill then uses it instead of packing and relinking.
   - [ ] Release subjects carry integrity for the dependency closure, so hosts verify bytes and not only versions.
2. **S3: priority upgrade admission and stale-runtime restart (main).** S3 lands on `main`, not `core-loop`: release speed is the owner's priority, and `core-loop` integration has no date.
   - [x] An upgrade asks for full-cycle admission with priority; a running cycle yields at its next stage boundary, and waiting residents queue behind the upgrade. `knowledge_cycle_admission_wait_expired` stays as the backstop. Implemented on `main` by [ADR-0574](../../decisions/distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md); the installed measurement is still pending.
   - [ ] Knowledge materialization that an upgrade only schedules runs as the next normal cycle after release (amends ADR-0214; needs its own decision). Held: ADR-0574 records why moving it now would leave non-owner hosts and parked convergence with stale knowledge reported as current.
   - [x] A replica whose process has no binding in the current runtime is restarted and reported as `repository_replica_service_stale_runtime`. Implemented on `main` by [ADR-0573](../../decisions/distribution/0573-restart-a-replica-coordinator-that-runs-a-superseded-runtime.md) (PR #259).
   - [ ] Measured on an installed release: no repository upgrade prints the admission wait, and publication to the last current repository is at most 12 minutes.
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

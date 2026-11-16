# ADR-0570: Install the verified CLI on each host and roll back by activation id

Status: `proposed` (Stage 1, `lervo host upgrade --from-release`, is implemented; Stages 2 and 3 are not)
Decision date: 2026-11-16
Amends: [ADR-0569](../release/packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (hosts consume the release subjects), [ADR-0488](../operations/services/0488-point-node-configurations-at-one-current-cli.md) (host installs live beside the `current` pointer)
Related: [ADR-0164](../operations/services/0164-user-runtime-service-management-boundary.md), [ADR-0214](../operations/services/0214-bounded-repository-upgrade-orchestration.md), [ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md), [ADR-0466](../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md)

## Context

The owner's target is 10 to 15 minutes from fix to fleet with no manual deploy. [ADR-0564](../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) and ADR-0569 shortened the path to a published release. After publication, an agent still runs the [deploy skill](../../../.agents/skills/deploy-lervo-release/SKILL.md) by hand.

The v0.23.7 deployment on 2026-11-14 left file timestamps on both hosts (KST). They are measured unless marked otherwise (+ means after publication):

| Step                                            | Window              | Minutes |
| ----------------------------------------------- | ------------------- | ------- |
| Merge to published release (ADR-0569)           | 18:33:52 – 18:48:31 | 14.7    |
| Pack CLI and Hub, copy, install (during matrix) | 18:36:43 – 18:37:13 | 0.5     |
| Hub backup and switch                           | – 18:49:38          | +1.1    |
| Relink `lervo`, `lervo-node` on both hosts      | – 18:49:53          | +1.4    |
| Mac: `upgrade-all.sh`, 9 repositories           | 18:49:53 – 19:12:11 | 22.3    |
| WSL: `upgrade-all.sh`, 7 repositories           | 18:49:56 – 19:24:09 | 34.2    |

Publication to the last current repository took 35.6 minutes, and merge to fleet took 50.3. Hub and CLI were fast only because the agent built them before publication, against the skill's order; afterwards they take an estimated 3 to 5 minutes more. Repository upgrades dominate. Of the 16 repository runs, 7 printed `Waiting up to 15 min for the running background knowledge cycle` ([ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md)). Repositories that applied only service stages still took 1.9 to 3.5 minutes each; how much was waiting is unmeasured. The WSL `lervo` repository took 21.0 minutes: 11.1 minutes of apply, a re-plan, and 7.5 more minutes. On the Mac it applied `knowledge_materialization` in 9.5 minutes. Background knowledge work, not installation, sets the critical path.

## Decision

Delivery has three stages, each useful on its own.

### Stage 1: `lervo host upgrade --from-release` (main, this change)

```text
lervo host upgrade --from-release <tag> --repository <owner/name> [--apply] [--bin-directory <path>] [--json]
lervo host upgrade --rollback <activation-id> [--apply] [--bin-directory <path>] [--json]
lervo host upgrade --status [--bin-directory <path>] [--json]
```

Without `--apply`, the command reads the release and the links and writes nothing ([ADR-0164](../operations/services/0164-user-runtime-service-management-boundary.md)). With `--apply`, one host does the skill's "build and transfer" and "global CLI" steps in a single locked run:

1. **Published only.** The release for the tag must exist, must not be a draft or prerelease, and must carry exactly the tarball, manifest, SBOM, and `release-subjects.json`. Releases from before ADR-0569 have no assets and fail with `host_release_assets_incomplete`.
2. **Verify against the tag, not the release.** The host resolves the tag to its commit and tree, following an annotated tag, downloads the assets into a fresh staging directory, and reads the tag commit's `apps/cli/release-artifact-manifest.json`, `release-sbom.cdx.json`, and `package.json`. It repeats ADR-0569's publication checks: binding tag and tree, exact file set, every size and SHA-256, manifest and SBOM byte-equal to the committed files, tarball contents equal to the committed manifest, and the tarball `package.json` equal to the committed one in every field. Without a checkout the host cannot read workspace versions, so a `workspace:` range in `devDependencies` only has to resolve to a version; those packages are bundled and never installed. A workspace range in any other field must match exactly. A failure discards the staging directory and reports the publication verifier's `release_subjects_*` code.
3. **Install side by side, with the verified closure only.** Verified files are kept under `<runtimes>/cli/downloads/<tag>-<commit12>/`, where `<runtimes>` is the parent of ADR-0483's Node runtimes. The tarball is installed into `<runtimes>/cli/installs/<version>-<commit12>/` with `pnpm install --ignore-scripts --prefer-offline`, without inherited `npm_config_*` or `pnpm_config_*`. The tarball pins only its direct dependencies; the v0.23.7 Mac install already holds `@babel/runtime@7.29.14` where the manifest names `7.29.7`. So pnpm overrides pin every package of the committed manifest's closure, and after the install the virtual store must hold exactly that closure plus this platform's packages of a listed platform family, or the run fails with `host_upgrade_dependencies_mismatch` and nothing is activated. A marker records the tarball digest; an existing directory is reused only for the same digest, otherwise `host_upgrade_install_conflict`.
4. **Activate, check, record.** A `pending` record with a new id `hact_<24 hex>`, the release coordinates, and each link's previous and new target is written first, so a crash mid-switch still leaves an id to roll back. Then `lervo` and `lervo-node` in the bin directory (default `~/.local/bin`) are switched to the install's `dist/bin.js` and `dist/node-runtime.js`, each by one rename. A failed rename puts every link back (`host_upgrade_switch_failed`). A regular file is never replaced (`host_upgrade_link_not_managed`). The health gate runs the `lervo` link itself, through its `#!/usr/bin/env node` line and the `node` on PATH, and requires exactly `lervo <version>`. The record ends `active`, or `restored` after a failed gate put the previous links back (`host_upgrade_health_failed`).
5. **Retention.** The journal `<runtimes>/cli/host-activations.json` keeps the newest 8 records. After an activation, kept downloads and installs are removed unless a retained record (including its rollback targets), a current link, or the `current` pointer references them, comparing both the layout and its physical path. Only directory names this layout creates are removed, plus leftover staging directories while the lock is held.

`--rollback <id> --apply` restores exactly the links that activation replaced, removing a link that did not exist before, and records a `rollback` activation. When any link has moved since, it refuses with `host_upgrade_rollback_superseded`; roll back the newer activation first. One lock per host serializes upgrades and rollbacks. It appears with its holder's pid already inside (a hard link of a private file), a dead holder's lock is renamed away before it is judged, and a run removes the lock only while it holds its own token. A live holder fails the second run with `host_upgrade_in_progress`.

Stage 1 deliberately leaves out:

- **The `current` pointer.** `lervo upgrade` still owns `current` (ADR-0488). Repository upgrades decide when Nodes move, so readers move before writers.
- **The Hub.** The Hub archive is not yet a release subject, so the skill still builds and installs it. Adding `lervo-hub-<version>-<platform>.tar.gz` to the subjects is a precondition for Stage 3.
- **Repository upgrades.** The skill still runs `upgrade-all.sh` after the host upgrade.

The release source is a port; its first adapter calls `gh` (`release view`, `api` for tag, commit, and raw contents at the exact commit, `release download`), so credentials stay in `gh`. A `gh` failure becomes `host_release_unavailable` without `gh` output, which can name credentials. The tarball reader is a TypeScript copy of `scripts/release/lib/npm-tarball-entries.mjs`. Publication verifies before any build and cannot import the bundle, and the bundle cannot import repository scripts.

### Stage 2 (S3): priority upgrade admission and stale-runtime restart (core-loop)

These touch upgrade and replica-service modules that `core-loop` rewrites, so they land there.

- **Priority admission.** An upgrade asks for full-cycle admission with priority. The running cycle yields at its next stage boundary instead of finishing, and a resident waiting for admission queues behind the upgrade. The 15-minute bound and `knowledge_cycle_admission_wait_expired` stay as a backstop.
- **Knowledge work off the critical path.** `knowledge_materialization` that an upgrade only schedules should run as the next normal cycle after release, not inside the upgrade. This changes ADR-0214 stage semantics and needs its own decision on core-loop.
- **Stale replicas.** The core-loop roadmap item: restart a replica whose process has no binding in the current runtime and report `repository_replica_service_stale_runtime`.

### Stage 3 (S4): `lervo host upgrade --follow` (after core-loop integration)

Every host runs the same follower: Stage 1, then `lervo upgrade` for every registered repository with Stage 2's admission. Only the Hub's ordering differs, and no host is excluded: by owner rule, cross-host conflicts are solved by coordination, never by restricting Lervo to one host.

- **Discovery.** Each host polls the release source for the newest published release, with jitter, about every 2 minutes. When a Hub is configured, it may also push a hint. The hint only triggers an earlier poll; the host still verifies against GitHub. Without a Hub, polling alone keeps working, so local execution never depends on the Hub.
- **Order.** The Hub host upgrades the Hub first and checks `/v1/health/ready` and `/v1/health/capabilities`. Other hosts wait until the Hub reports the release's readable event schema versions. With no Hub configured, a host goes straight on. Repositories follow their host's CLI, so readers come before writers as `lervo upgrade` already requires.
- **Health gate and rollback.** A host whose `--version` probe, Node readiness, or repository upgrade fails rolls back its own activation by id and reports the failure. It does not retry that tag until a newer release appears or the owner resumes it.
- **Authority.** Deployment is a consequential effect, and the owner's rule is no release without the owner's decision. Publication is that decision: a release exists only after reviewed release intent merges and the workflow publishes verified subjects. A follower installs only such releases and never creates tags or releases. `lervo host upgrade --pause` and `--resume` hold or release following, host-local and through the Hub for every host. A pinned tag stops following at that tag.

## States, failures, and privacy

The journal record holds `activationId`, `kind` (`release` or `rollback`), `outcome` (`pending`, `active`, or `restored`), `activatedAt`, `links[]` (`name`, `path`, `previous`, `current`), the release coordinates (`repository`, `tag`, `version`, `commit`, `tree`, `tarballSha256`, `installDirectory`, `downloadDirectory`), and `rolledBackActivationId` for a rollback. It holds local paths and release coordinates only, mode `0600`, as a bounded projection. Stage 1 emits no runtime event.

Failure codes:

- `host_upgrade_arguments_invalid`: missing, conflicting, or malformed arguments.
- `host_upgrade_platform_unsupported`: a Windows host, not supported yet.
- `host_release_unavailable`: the release, tag, commit, or file could not be read through `gh`.
- `host_release_not_published`: the release is a draft or prerelease.
- `host_release_assets_incomplete`: the release does not carry exactly the four subjects.
- `release_subjects_*`: a verification check from ADR-0569 failed; nothing was installed.
- `host_upgrade_download_conflict`: a kept download of the same tag and commit holds different bytes.
- `host_upgrade_install_failed`: the installer failed or produced another version; output kept in `last-install-failure.log`.
- `host_upgrade_dependencies_mismatch`: the install resolved npm packages outside the verified closure; nothing was activated.
- `host_upgrade_switch_failed`: a link rename failed; the previous links were restored.
- `host_upgrade_install_conflict`: the install directory exists for another tarball digest.
- `host_upgrade_link_not_managed`: a bin entry is a regular file, which Lervo never replaces.
- `host_upgrade_health_failed`: the switched executable failed `--version`; previous links were restored.
- `host_upgrade_in_progress`: another live upgrade holds the host lock.
- `host_upgrade_activation_unknown`: the activation id is not in the retained journal.
- `host_upgrade_rollback_superseded`: a link moved after the activation; roll back the newer one first.
- `host_upgrade_journal_invalid`: the journal is unreadable; it was left untouched.

## Where it lands

Stage 1 lands on `main` now. It adds new modules and one route in `main.ts`, and it changes no file that `core-loop` rewrites except that route. It needs no further product decision, works without a Hub, and the skill can call it once a release carries it. Stages 2 and 3 land on `core-loop` with its integration release, as planned, because they change upgrade stages and Hub-ordered rollout that `core-loop` reshapes.

## Consequences

Projected fix-to-fleet times. The baseline is measured; every later row is estimated:

| After              | Merge → published | Published → fleet | Note                                                  |
| ------------------ | ----------------- | ----------------- | ----------------------------------------------------- |
| v0.23.7 (measured) | 14.7              | 35.6              | Agent runs every step                                 |
| ADR-0569           | ~3.5              | ~36               | First real release confirms                           |
| Stage 1            | ~3.5              | ~33               | No pack, copy, or hand relink; repositories unchanged |
| Stage 2            | ~3.5              | ~10–12            | Admission waits and in-upgrade materialization gone   |
| Stage 3            | ~3.5              | ~8–10             | Hosts in parallel, no agent latency                   |

Fix to fleet also includes PR verification, which took 23.1 minutes on v0.23.7. The 10-to-15-minute target needs Stage 3 together with the CI work that tracks PR verification time ([CI cost and duration](../../roadmap/operations/ci-cost-and-duration.md)).

Open owner decisions before Stage 3: the poll interval; whether `--follow` installs every published release or only the newest; the default repository coordinate in place of `--repository`; and whether a Hub-wide pause needs its own Node credential scope.

## Verification

`apps/cli/test/host-release-verification.test.ts` covers acceptance and each verification failure, including consistently rebound metadata, an extra tarball file, a changed `scripts` field, and workspace ranges. `host-cli-dependencies.test.ts` covers virtual-store parsing, overrides, and the drift seen on v0.23.7. `host-release-source.test.ts` covers annotated tags, exact `gh` arguments, and failure translation without `gh` output. `host-release-retention.test.ts` covers a home reached through a symbolic link. `host-upgrade.test.ts` covers the read-only plan and its `current` state after an apply, refusal of drafts, prereleases, and incomplete assets, activation with a real `--version` run of the link, idempotent re-apply, the health-gate restore, the closure check, user-owned files, live and crashed locks, discarded downloads, pruning, rollback and its refusals, the journal bound and damaged journals, the command surface, and a real `pnpm` install in an isolated home.

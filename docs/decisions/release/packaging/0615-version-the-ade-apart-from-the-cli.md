# ADR-0615: Version the ADE apart from the CLI

Status: `accepted`
Decision date: 2026-11-23
Amends: [ADR-0221](0221-reviewed-cli-release-preparation.md) (ADE intents in `.changes/ade/`), [ADR-0613](../../execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) (the ADE keeps versions and release notes before S3 distributes it)

## Context

The Lervo ADE has three parts that ship together: the React interface, the Tauri shell, and the Rust session host. Every manifest of these parts says `0.1.0`, and nothing records what changed between builds. ADR-0613 leaves distribution (S3) until S1 completes, and nothing so far decided when versions would start. On 2026-11-23 the owner asked for ADE versions and release notes like the CLI's.

The release tooling serves only the CLI:

- `.changes/config.json` names `@lervo/cli` as its sole public package. Every intent carries `package: "@lervo/cli"`, which its ID's digest covers.
- Workflows and scripts find a pending CLI intent by listing `.changes/*.yaml` or `.changes/relint_*.yaml`. This applies to release preparation, the release pull request, the CI verification plan, candidate reconciliation, and the release CI check.
- Release preparation, the completion check, and the release matrix read every intent as a CLI intent.
- CLI tags are `v<major>.<minor>.<patch>`. Several mechanisms key on the `v` prefix:
  - the release matrix (`startsWith(github.ref_name, 'v')`);
  - attested-CLI reuse ([ADR-0614](0614-sign-the-verified-release-subjects.md));
  - the tag wait in the release runbook;
  - the host follower.
- The host follower ([ADR-0575](../../distribution/0575-follow-published-releases-on-every-host.md)) reads the newest 30 GitHub Releases of the repository. It installs the newest published one whose tag matches `^v(\d+)\.(\d+)\.(\d+)$`.

The ADE and the core are separate processes, often from different releases. The session-host protocol negotiates its version in the handshake. On the core link, the core advertises the application commands it answers ([the ADE core link](../../../specifications/execution/product-surfaces/ade-core-link.md)).

## Decision

### One ADE version

- **One version for three parts.** The interface, the shell, and the session host share one version.
  - `apps/ade/package.json` holds it.
  - Preparation writes it to `apps/ade/src-tauri/tauri.conf.json` and to every Cargo manifest under `apps/ade`.
  - A check fails when any of them differ.
- **The version policy is the CLI's.** Before 1.0, `patch` increments the patch number, and `minor` and `major` increment the minor number.

### ADE intents in their own directory

- **The directory.** An ADE intent is a release intent with `package: "@lervo/ade"` in `.changes/ade/`. The intent format stays v1, and the package field and its digest work as they do for the CLI.
- **Why a directory.** Every listing of `.changes/*.yaml` and `.changes/relint_*.yaml` reads one directory level. A CLI intent stays a CLI intent, existing intents and branches keep their meaning, and no CLI workflow or script sees an ADE intent, so none of them changes.
- **Creating an intent.** `pnpm release:intent:create --target ade` writes an ADE intent. Without `--target`, the command writes a CLI intent as before, and its existing flags and output stay unchanged.
- **When an ADE intent is needed.** A pull request needs one when it changes the ADE's behavior: the interface, the shell, the session host, or a contract package as the ADE bundles it. Tests, documentation, and internal refactors outside those closures are exempt, as for the CLI.
- **Both targets.** A pull request that changes both the CLI and the ADE carries one intent for each.

### Separate preparation

- **Separate paths.** CLI preparation, the CLI completion check, and the release matrix ignore ADE intents, because they read only `.changes/`. ADE preparation ignores CLI intents. A pending ADE intent never stales or blocks a CLI preparation.
- **What ADE preparation does.** It works as [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) describes for the CLI, inside the feature pull request:
  - it consumes the ADE intents;
  - it writes the next version to every ADE manifest;
  - it replaces `.changes/ade/current-release.md` with the release notes.
- **Release notes.** They state the minimum Lervo CLI version the release needs, and they follow `writing_en-human`.
- **The preparation commit.** ADE preparation commits with its own subject, `chore(ade): prepare release`. The release wait and the rule against pushing on top of a preparation commit recognize it as they recognize the CLI's.
- **Tags.** After the merge, an exact plan tags the prepared revision `ade-v<major>.<minor>.<patch>`. Nothing that keys on the `v` prefix matches it, so no CLI workflow starts.
- **Merges after a CLI release.** On 2026-11-23 an ADE-only merge landed a minute after a prepared CLI merge. It cancelled the CLI merge's main CI, and the CLI tag plan ran as skipped. Until the CLI tag plan tolerates a later merge, nothing merges to `main` between a prepared CLI merge and its `v` tag. ADE preparation must not repeat the problem: a CLI tag plan must never be skipped because an ADE merge followed it.

### No GitHub Release before S3

- **No release before S3.** The ADE creates no GitHub Release until S3 distributes signed bundles. Git tags and the release-note history in Git hold the history until then.
- **Conditions for S3.** S3 may publish ADE releases only after all of the following hold:
  - every ADE release is created without the "Latest" mark, so the CLI release stays the repository's latest;
  - the host follower selects releases by tag pattern, which it already does;
  - the follower's release listing cannot lose the newest CLI release behind ADE releases, for example by listing CLI tags explicitly instead of the newest 30 releases;
  - tests prove the selection with ADE releases among the newest entries for `lervo host upgrade --follow`, `--from-release`, and every other release lookup of `lervo host upgrade`.

### Compatibility at run time

The ADE never assumes a core version:

- It reads the core's advertised commands.
- It falls back to the base commands for a core that advertises none.
- It tells the user when the installed Lervo is older than the app needs.

## Consequences

- ADE changes gain a release record from their first prepared release, before anyone installs a bundle.
- Release tooling learns a second directory. The shared intent library reads one directory per version line, and only ADE tooling reads `.changes/ade/`. CLI workflows and scripts stay as they are.
- A pull request that changes both targets carries two intents and runs two preparations. The two version lines move independently.
- The first prepared ADE release will be `0.2.0`, since the ADE has gained the native conversation, the CLI conversation, and transcript sync since `0.1.0`.

## Verification

- Release-script tests cover:
  - an ADE intent in `.changes/ade/` that CLI loading, preparation, and the completion check never see;
  - CLI preparation and the completion check ignoring ADE intents;
  - ADE preparation ignoring CLI intents and writing every ADE manifest;
  - the `ade-v` tag plan.
- A contract check fails when the ADE manifests disagree on the version.
- Every test under `scripts/release` runs locally before a release-script change is pushed, because a failed preparation costs a full CI cycle.
- Before S3 publishes an ADE release, tests list ADE releases among the newest entries and still select the newest CLI release for following, `--from-release`, and every other release lookup of `lervo host upgrade`.
- A test merges an ADE-only commit right after a prepared CLI commit and still gets the CLI tag.

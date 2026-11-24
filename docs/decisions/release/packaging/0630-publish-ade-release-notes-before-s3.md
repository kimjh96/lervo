# ADR-0630: Publish ADE release notes before S3

Status: `accepted`
Decision date: 2026-11-24
Amends: [ADR-0615](0615-version-the-ade-apart-from-the-cli.md) (ADE releases publish on GitHub before S3), [ADR-0575](../../distribution/0575-follow-published-releases-on-every-host.md) (the follower's release list widens past ADE releases)

## Context

On 2026-11-23 the owner asked for ADE versions and release notes like the CLI's. ADR-0615 gave the ADE its version line and its notes, but it deferred GitHub Releases until S3 distributes signed bundles. ADE 0.2.0 and 0.2.1 shipped with notes that only Git history held: preparation replaces `.changes/ade/current-release.md` each time, and the tags carry only a title. On 2026-11-24 the owner asked why the ADE had no release notes. The notes existed, but nowhere a person would look.

ADR-0615 deferred publication to protect the host follower ([ADR-0575](../../distribution/0575-follow-published-releases-on-every-host.md)). The follower lists the newest 30 releases and installs the newest published `v<version>` tag. An ADE release could take the "Latest" mark, or enough ADE releases could push every CLI release out of that list. ADR-0615 named three conditions for publishing: no "Latest" mark, selection by tag pattern, and a list that cannot lose the newest CLI release behind ADE releases, all proven by tests.

## Decision

- **Publish every ADE release.** After the ADE release workflow tags `ade-v<version>`, `scripts/release/lib/publish-ade-release.sh` creates the GitHub Release `@lervo/ade v<version>` with that tag's notes. It attaches no files; S3 adds signed bundles.
- **Never "Latest".** The script creates and updates the release with `--latest=false`, so the CLI release stays the repository's latest.
- **Safe input.** The script accepts only an `ade-v<major>.<minor>.<patch>` tag, and only notes whose `lervo-release` marker names `@lervo/ade` and that version. On replay it updates the existing release in place.
- **The follower's list widens.** When the newest 30 releases hold no published `v<version>` release, the follower lists the newest 300 instead. ADE releases therefore cannot hide the newest CLI release unless 300 of them follow it. Selection still keeps only published `v<version>` tags, so the follower never installs an ADE release.
- **Earlier releases.** ADE 0.2.0 and 0.2.1 are published once by hand from the notes at their tags, after the CLI release that widens the list has been canaried.

## Consequences

- ADE release notes are on GitHub next to the CLI's, each under its own tag and title.
- The repository's release list mixes `@lervo/cli` and `@lervo/ade` entries. Every tool that picks a CLI release must keep selecting by the `v` tag pattern and never by position or the "Latest" mark.
- A host on a CLI from before the widening still selects correctly while fewer than 30 ADE releases follow the newest CLI release, which the release cadence makes far off.

## Verification

- `scripts/release/test/publish-ade-release.test.mjs`: creation without "Latest" and without files, replay as an edit, and refusal of a CLI tag or notes of another version before `gh` runs.
- `apps/cli/test/host-release-source.test.ts`: a newest page of 30 ADE releases widens to 300 and returns the CLI release behind them; a page with a published CLI release, or a short list, stays as it is; a page whose only CLI release is a draft widens.
- `apps/cli/test/host-follow-policy.test.ts`: the follower never installs an ADE release, however new.

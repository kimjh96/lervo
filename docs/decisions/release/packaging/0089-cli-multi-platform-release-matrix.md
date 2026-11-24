# ADR-0089: CLI multi-platform release matrix

Status: `accepted`
Decision date: 2026-08-20
Amended by: [ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (the matrix runs before merge, and a tag run can publish without rebuilding), [ADR-0581](0581-build-darwin-native-files-with-one-pinned-xcode.md) (the macOS legs run on `macos-15` with a pinned Xcode), [ADR-0614](0614-sign-the-verified-release-subjects.md) (`attested-cli` signs the verified subjects instead of a rebuild)

## Context

Packed smoke tests prove only their current OS. Claude Agent SDK selects optional packages by OS, CPU, and Linux libc. Tests reusing the production resolver could share its naming bug.

## Decision

- Independently derive supported native suffixes: macOS `darwin-arm64/x64`; glibc Linux `linux-arm64/x64`; musl Linux `linux-arm64-musl/x64-musl`; Windows `win32-arm64/x64`. Produce none for unsupported combinations.
- Require exactly one matching native-family package in the installed production closure, with the correct name, SDK version, OS, and CPU. Require its executable bit on macOS and Linux.
- Execute its `claude` or `claude.exe --version` directly, without authentication or a session.
- Run `.github/workflows/cli-release-matrix.yml` on Ubuntu, macOS, and Windows with `fail-fast: false`, checkout without write credentials, Node 22.13.0, pnpm 11.18.0, frozen installation, workspace build, release-manifest check, and packed-consumer smoke.
- Originally require pull-request, main-push, and manual-dispatch triggers, `contents: read`, a 20-minute timeout, and actions pinned to reviewed full commit SHAs. The current workflow amendment below supersedes the trigger description.
- Treat the workflow as code. Local tests verify triggers, OS set, permissions, credential handling, SHAs, tool versions, commands, and independent platform-name mapping.
- Never claim unexecuted remote jobs succeeded. Upload no user payload, credential, or path, and create no project events.

## Consequences

The current local platform and each completed matrix job provide separate evidence. The original matrix does not establish coverage of all architectures, real musl runners, published npm, provider authentication or network access, signing, or SBOM. The amendment below extends SBOM and signed-attestation verification scope.

[ADR-0215](0215-supported-runtime-release-portability.md) makes built-in classification independent of the checker's Node inventory, keeps Node 22.13 SQLite loading quiet, and makes temporary deployments portable across Windows volumes.

## Current workflow amendment

### Triggers and concurrency

The supplied `.github/workflows/cli-release-matrix.yml` declares pull requests, pushes of `v*` tags, and manual dispatch with an optional `expected_sha` input, with no main-branch push trigger. The first job, `plan`, runs for non-pull-request events or when the pull-request head branch is exactly `lervo/release-cli`; ordinary pull requests run no job. `plan` outputs the tree and an optional reusable run ID ([ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md)). Concurrency groups by workflow and ref and cancels replaced in-progress runs.

### Packed verification

The `native-runtime` and `packed-cli` jobs run only when `plan` chose no reusable run. The packed job retains Ubuntu, macOS (`macos-15`), Windows, `fail-fast: false`, a 20-minute timeout, `contents: read`, and checkout without persisted credentials. It uses SHA-pinned actions, Node 22.13.0 with package-manager caching disabled, pnpm setup, and frozen installation. The YAML specifies no pnpm version, so this source alone cannot verify the original 11.18.0 coordinate.

The supplied workflow pins:

- `actions/checkout`: `de0fac2e4500dabe0009e67214ff5f5447ce83dd` (v6.0.2).
- `actions/setup-node`: `820762786026740c76f36085b0efc47a31fe5020` (v7.0.0).
- `pnpm/action-setup`: `d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (v6.0.8).
- `actions/download-artifact`: `634f93cb2916e3fdff6788551b99b062d0335ce0` (v5), used by `packed-cli`, `attested-cli`, and `github-release`.

These are exact configuration identities, not evidence that a remote job ran. After building, the job checks the release manifest, SBOM, and local attestation statement, runs packed-consumer smoke, and tests publication and installation through an isolated registry. The Ubuntu leg binds and keeps the exact release subjects as `lervo-cli-release-<tree>`.

### Attestations and release artifacts

The `attested-cli` job needs `plan` and `packed-cli` and runs under `!cancelled()` only for `v*` tag refs where the repository is not both private and personally owned, when `plan` succeeded and either a reusable run was chosen or `packed-cli` succeeded. It uses Ubuntu, a 20-minute timeout, and `contents: read`, `actions: read`, `id-token: write`, `attestations: write`, and `artifact-metadata: write`.

The job never rebuilds or repacks the CLI ([ADR-0614](0614-sign-the-verified-release-subjects.md)). It builds only `@lervo/runtime-security`, downloads `lervo-cli-release-<tree>` from the reusable run or its own run, verifies the subjects against the tagged tree with `cli-release-subjects.mjs verify`, and stages the tarball, manifest, and SBOM for signing. It attests build provenance and the tarball SBOM, collects signed bundles, and verifies them against the repository, tag, and source digest.

- Build-provenance attestation names three subjects: the `*.tgz` tarball, `release-artifact-manifest.json`, and `release-sbom.cdx.json`.
- The separate SBOM attestation names the tarball as subject and the CycloneDX file as `sbom-path`.
- Both attestation steps pin `actions/attest` to `508db95dd578ae2727ebd6217d5ba78e4fbda05d` (v4.2.1).
- Artifact upload pins `actions/upload-artifact` to `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (v7.0.1).

The job then generates exact publication-authorization coordinates for the `latest` dist-tag. Release files, signed bundles, and the authorization record are uploaded as `lervo-cli-${{ github.ref_name }}` with 30-day retention. Missing upload files are an error.

### GitHub Release

The `github-release` job needs `plan`, `packed-cli`, and `attested-cli` and runs under `!cancelled()` for a `v*` tag when `plan` succeeded, either a reusable run was chosen or `packed-cli` succeeded, and attestation succeeded or was skipped; attestation failure blocks it. On the reuse path it publishes even though `packed-cli` was skipped. It uses Ubuntu, a ten-minute timeout, `contents: write`, and `actions: read`.

The job validates the current release note against the expected tag, downloads `lervo-cli-release-<tree>` from the chosen run, and verifies it against the tagged tree. When attestation succeeded, it requires the attested files to equal the verified subjects. `publish-github-release.sh` then creates or reconciles the release, titled `@lervo/cli <tag>` with its notes, and attaches the tarball, manifest, SBOM, and binding as assets ([ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md)).

### Evidence boundaries

The later jobs extend verification to SBOMs and supported signed attestations. The workflow contains no npm staging or public npm publication step. Isolated-registry smoke and an authorization record do not establish public publication. Configuration proves neither completed remote jobs nor successful artifact verification.

See [ADR-0221](0221-reviewed-cli-release-preparation.md) for release preparation, explicit matrix dispatch, replay, and authority boundaries.

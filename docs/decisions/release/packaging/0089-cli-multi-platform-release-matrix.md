# ADR-0089: CLI multi-platform release matrix

Status: `accepted`
Decision date: 2026-08-20

## Context

Packed smoke tests prove only their current OS. Claude Agent SDK selects optional packages by OS, CPU, and Linux libc. Tests that reuse the production resolver could share its naming bug.

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

The supplied current `.github/workflows/cli-release-matrix.yml` declares pull requests, pushes of `v*` tags, and manual dispatch; it does not declare main-branch pushes. The `packed-cli` job runs for non-pull-request events or when the pull-request head branch is exactly `lervo/release-cli`. Ordinary pull requests do not execute this matrix job. Concurrency groups by workflow and ref and cancels an in-progress run when replaced.

### Packed verification

The packed job retains Ubuntu, macOS, Windows, `fail-fast: false`, a 20-minute timeout, `contents: read`, and checkout without persisted credentials. It uses SHA-pinned actions, Node 22.13.0 with package-manager caching disabled, pnpm setup, and frozen installation. The YAML does not specify a pnpm version, so this source alone cannot verify the original 11.18.0 coordinate.

The supplied workflow pins `actions/checkout` to `de0fac2e4500dabe0009e67214ff5f5447ce83dd` (v6.0.2), `actions/setup-node` to `820762786026740c76f36085b0efc47a31fe5020` (v7.0.0), and `pnpm/action-setup` to `d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (v6.0.8). These are exact configuration identities, not evidence that a remote job ran.

After building, the job checks the release manifest, SBOM, and local attestation statement, runs packed-consumer smoke, and tests publication and installation through an isolated registry.

### Attestations and release artifacts

The `attested-cli` job depends on the packed job and runs only for `v*` tag refs where the repository is not both private and personally owned. It uses Ubuntu, a 20-minute timeout, and `contents: read`, `id-token: write`, `attestations: write`, and `artifact-metadata: write`.

The job rebuilds and verifies release metadata, prepares subjects against the expected tag, attests build provenance and the tarball SBOM, collects signed bundles, and verifies them against the repository, tag, and source digest. Its build-provenance attestation names three subjects: the `*.tgz` tarball, `release-artifact-manifest.json`, and `release-sbom.cdx.json`. The separate SBOM attestation names the tarball as subject and the CycloneDX file as `sbom-path`. Both attestation steps pin `actions/attest` to `508db95dd578ae2727ebd6217d5ba78e4fbda05d` (v4.2.1). The artifact upload pins `actions/upload-artifact` to `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (v7.0.1). It then generates exact publication-authorization coordinates for the `latest` dist-tag. Release files, signed bundles, and the authorization record are uploaded as `lervo-cli-${{ github.ref_name }}` with 30-day retention. Missing upload files are an error.

### GitHub Release

The `github-release` job requires a `v*` tag, successful packed verification, and attestation success or skip. Attestation failure blocks it. It uses Ubuntu, a ten-minute timeout, and `contents: write`.

The job validates the current release note against the expected tag, then edits an existing GitHub Release or creates one with `--verify-tag`, using `.changes/current-release.md` and the title `@lervo/cli <tag>`.

### Evidence boundaries

These later jobs extend verification to SBOMs and supported signed attestations. The workflow contains no npm staging or public npm publication step. Isolated-registry smoke and an authorization record do not establish public publication. Configuration proves neither completed remote jobs nor successful artifact verification.

See [ADR-0221](0221-reviewed-cli-release-preparation.md) for release preparation, explicit matrix dispatch, replay, and authority boundaries.

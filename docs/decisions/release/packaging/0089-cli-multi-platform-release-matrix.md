# ADR-0089: CLI multi-platform release matrix

Status: `accepted`
Decision date: 2026-08-20

## Context

Packed smoke proves only its current OS. Claude Agent SDK installs different optional packages by OS, CPU, and Linux libc. A test that reuses the production resolver could share its naming bug.

## Decision

- Independently derive supported native suffixes: macOS `darwin-arm64/x64`; glibc Linux `linux-arm64/x64`; musl `linux-arm64-musl/x64-musl`; Windows `win32-arm64/x64`. Produce none for unsupported combinations.
- Require exactly one matching native-family package in the installed production closure, with the correct name, SDK version, OS, and CPU, plus an executable bit on macOS and Linux.
- Execute its `claude` or `claude.exe --version` directly without authentication or a session.
- `.github/workflows/cli-release-matrix.yml` runs Ubuntu, macOS, and Windows with `fail-fast: false`, checkout without write credentials, Node 22.13.0, pnpm 11.18.0, frozen installation, workspace build, release-manifest check, and packed-consumer smoke.
- Trigger on pull requests, pushes to main, and manual dispatch. Set `contents: read`, a 20-minute timeout, and pin actions to reviewed full commit SHAs.
- Treat the workflow as code. Local tests verify triggers, OS set, permissions, credential handling, SHAs, tool versions, commands, and independent platform-name mapping.
- Never claim that unexecuted remote jobs succeeded. Upload no user payload, credential, or path, and create no project events.

## Consequences

The current local platform and each completed matrix job provide separate evidence. This still excludes all architectures, real musl runners, published npm, provider authentication or network access, signing, and SBOM.

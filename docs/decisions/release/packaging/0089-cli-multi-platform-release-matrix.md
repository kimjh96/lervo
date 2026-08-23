# ADR-0089: CLI multi-platform release matrix

Status: `accepted`
Decision date: 2026-08-20

## Context

Packed smoke proves only its current OS. Claude Agent SDK installs different optional packages by OS/CPU/Linux libc, and a test reusing production resolver could share the same naming bug.

## Decision

- Independently derive supported native suffixes: macOS `darwin-arm64/x64`; glibc Linux `linux-arm64/x64`; musl `linux-arm64-musl/x64-musl`; Windows `win32-arm64/x64`. Produce none for unsupported combinations.
- Require exactly one matching native-family package in installed production closure, with correct name/SDK version/OS/CPU and executable bit on macOS/Linux.
- Execute its `claude`/`claude.exe --version` directly without authentication/session.
- `.github/workflows/cli-release-matrix.yml` runs Ubuntu/macOS/Windows with `fail-fast: false`, checkout without write credentials, Node 22.13.0, pnpm 11.18.0, frozen install, workspace build, release manifest check, and packed consumer smoke.
- Trigger on PR, main push, and manual dispatch; permissions `contents: read`; timeout 20 minutes; pin actions to reviewed full commit SHAs.
- Treat workflow as code: local tests verify triggers, OS set, permissions, credential handling, SHAs, tool versions, commands, and independent platform-name mapping.
- Never claim unexecuted remote jobs succeeded. Upload no user payload/credential/path and create no project events.

## Consequences

Current local platform and each completed matrix job provide separate evidence. This still excludes all architectures, real musl runners, published npm, provider auth/network, signing, and SBOM.

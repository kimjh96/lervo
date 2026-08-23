# ADR-0086: Canonical CLI release artifact manifest

Status: `accepted`
Decision date: 2026-08-20

ADR-0087–0092 evolve the manifest through bundle, README/metadata, and SBOM source schemas; v1 below records the pre-bundle archive contract.

## Context

Deploy smoke did not lock intended archive files/dependency closure, and pack included source/tests/config/cache. Tar metadata makes whole-tar hashes unstable, while platform-native provider packages cannot be a single global name list.

## Decision

- v1 permitted only `dist/**/*.js`, `dist/**/*.d.ts`, and npm-required `package.json`; reject any other packed source/config/cache.
- `release-artifact-manifest.json` is one replace-in-place source, never appended history.
- Record package identity/entrypoints/patterns, normalized direct production dependencies, sorted dist paths/counts/SHA-256 plus canonical digest, portable deployed dependency closure/digest, platform package prefix/version family, and final digest binding all sections.
- Hash sorted canonical JSON plus fixed newline, excluding tar headers, time, temporary paths, symlink locations, and platform name.
- Treat Claude native packages as prefix `@anthropic-ai/claude-agent-sdk-` plus exact version family and verify OS/CPU declarations without echoing offending names.
- Only `release:manifest:update` rewrites; check commands are read-only, re-create pack/deploy after build, verify manifest self-digest first, and report only bounded section names.
- Remove temporary deploys and store no user path/payload/credential.

## Consequences

Archive/source/dependency changes require explicit manifest update. The manifest proves local content, not signing, SBOM, registry publication/download, all-platform execution, or how private workspaces ship.

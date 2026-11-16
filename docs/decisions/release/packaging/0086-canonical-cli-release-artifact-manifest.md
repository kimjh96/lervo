# ADR-0086: Canonical CLI release artifact manifest

Status: `accepted`
Decision date: 2026-08-20
Amended by: [ADR-0572](0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md) (release preparation commits the manifest; CI generates it for other changes)

ADR-0087–0092 evolve the manifest through bundle, README/metadata, and SBOM source schemas. Version 1 below records the pre-bundle archive contract.

## Context

Deploy smoke did not constrain intended archive files or dependency closure, and packing included source, tests, configuration, and cache. Tar metadata makes whole-tar hashes unstable, while platform-native provider packages cannot use one global name list.

## Decision

- Version 1 permits only `dist/**/*.js`, `dist/**/*.d.ts`, and npm-required `package.json`; reject every other packed source, configuration, or cache file.
- `release-artifact-manifest.json` is one replace-in-place source, never appended history.
- Record package identity, entrypoints, patterns, normalized direct production dependencies, sorted dist paths/counts/SHA-256 and canonical digest, portable deployed dependency closure and digest, platform-package prefix and version family, and a final digest binding every section.
- Hash sorted canonical JSON plus a fixed newline. Exclude tar headers, time, temporary paths, symlink locations, and platform name.
- Treat Claude native packages as prefix `@anthropic-ai/claude-agent-sdk-` plus the exact version family. Verify OS/CPU declarations without echoing offending names.
- Only `release:manifest:update` rewrites the manifest. Check commands are read-only, recreate pack and deploy after build, verify the manifest self-digest first, and report only bounded section names.
- Remove temporary deployments and store no user path, payload, or credential.

## Consequences

Archive, source, or dependency changes require an explicit manifest update. The manifest proves local content, not signing, SBOM, registry publication or download, all-platform execution, or how private workspaces ship.

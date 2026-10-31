# ADR-0087: Single-bundle CLI deployment unit

Status: `accepted`
Decision date: 2026-08-20
Amended by: [ADR-0502](0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) (published file set)

## Context

The CLI uses 24 private workspace packages. Publishing them separately would expose internal units and couple their versions and release ordering, while removing module boundaries would harm separation and testing. Most external JavaScript can be bundled, but the Claude Agent SDK resolves platform-native packages relative to its installation and must remain external.

## Decision

- Preserve workspace TypeScript and contracts during development. After all builds, bundle `apps/cli/src/bin.ts`, internal code, Ajv, and YAML into ESM `dist/bin.js`, retaining the shebang and providing `createRequire(import.meta.url)` compatibility for CJS-style built-ins.
- Externalize only `@anthropic-ai/claude-agent-sdk`. Public runtime dependencies contain it; private Lervo packages remain build-only.
- Publish only `dist/bin.js` and npm `package.json`; expose no library entrypoint or declarations. [ADR-0502](0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) later widened the archive to three JavaScript executables, the repository runtime, native assets, and README. It still exposes no library entrypoint or declarations, and `dist/` stays out of Git.
- Keep the build metafile out of the archive. Manifest v2 binds the entry and output, bundled workspace-package versions, remaining non-builtin imports, package and direct dependencies, bundle hash, deployed closure, and final digest.
- Fail on unexpected external imports, any external dependency other than the Claude SDK, or deployed private Lervo packages.
- Run the bundled CLI externally in installed smoke tests. Independently built readers and writers confirm storage and report compatibility.

## Consequences

Users install one CLI artifact while development code remains modular. This proves local build, pack, and deploy behavior, not registry installation, empty-consumer tar installation, every native platform, signing, or SBOM.

## Amendment (2026-10-31)

The deployment unit is still one npm package built from modular workspace sources, but it is no longer one file. The package now publishes `dist/bin.js`, `dist/terminal-hook.js`, `dist/node-runtime.js`, the shared `dist/repository-runtime.js` with its members and `repository-runtime.json` inventory, and the native asset pairs under `dist/native/`. The current build and file list are specified in [CLI bundle build configuration and execution](../../distribution/cli-bundle-construction/build.md), under [ADR-0502](0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) and [ADR-0503](../execution/verification/0503-compile-schema-validators-at-build-time.md). `dist/` is a build output and is not tracked in the repository.

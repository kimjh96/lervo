# ADR-0087: Single-bundle CLI deployment unit

Status: `accepted`
Decision date: 2026-08-20

## Context

The CLI uses 24 private workspace packages. Publishing them separately would expose internal units and couple their versions and release ordering, while removing module boundaries would harm separation and testing. Most external JavaScript can be bundled, but the Claude Agent SDK resolves platform-native packages relative to its installation and must remain external.

## Decision

- Preserve workspace TypeScript and contracts during development. After all builds, bundle `apps/cli/src/bin.ts`, internal code, Ajv, and YAML into ESM `dist/bin.js`, retaining the shebang and providing `createRequire(import.meta.url)` compatibility for CJS-style built-ins.
- Externalize only `@anthropic-ai/claude-agent-sdk`. Public runtime dependencies contain it; private Lervo packages remain build-only.
- Publish only `dist/bin.js` and npm `package.json`; expose no library entrypoint or declarations.
- Keep the build metafile out of the archive. Manifest v2 binds the entry and output, bundled workspace-package versions, remaining non-builtin imports, package and direct dependencies, bundle hash, deployed closure, and final digest.
- Fail on unexpected external imports, any external dependency other than the Claude SDK, or deployed private Lervo packages.
- Run the bundled CLI externally in installed smoke tests. Independently built readers and writers confirm storage and report compatibility.

## Consequences

Users install one CLI artifact while development code remains modular. This proves local build, pack, and deploy behavior, not registry installation, empty-consumer tar installation, every native platform, signing, or SBOM.

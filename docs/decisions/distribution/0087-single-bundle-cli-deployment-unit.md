# ADR-0087: Single-bundle CLI deployment unit

Status: `accepted`
Decision date: 2026-08-20

## Context

CLI uses 24 private workspace packages. Publishing them separately exposes internal units and couples versions/order; removing module boundaries would harm separation/testing. Most external JS can bundle, but Claude Agent SDK resolves platform-native packages relative to its install and must remain external.

## Decision

- Preserve workspace TypeScript/contracts during development. After all builds, bundle `apps/cli/src/bin.ts`, internal code, Ajv, and YAML into ESM `dist/bin.js`, retaining shebang and providing `createRequire(import.meta.url)` compatibility for CJS-style built-ins.
- Externalize only `@anthropic-ai/claude-agent-sdk`. Public runtime dependencies contain it; private Lervo packages are build-only.
- Publish only `dist/bin.js` and npm `package.json`; expose no library entrypoint/declarations.
- Keep build metafile out of archive. Manifest v2 binds entry/output, bundled workspace package versions, remaining non-builtin imports, package/direct dependencies, bundle hash, deployed closure, and final digest.
- Fail unexpected external imports, anything besides Claude SDK, or deployed private Lervo packages.
- Installed smoke runs bundled CLI externally; independently built readers/writers confirm storage/report compatibility.

## Consequences

Users install one CLI artifact while code remains modular. This proves local build/pack/deploy, not registry, empty-consumer tar install, all-native platforms, signing, or SBOM.

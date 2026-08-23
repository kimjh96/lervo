# ADR-0167: Platform-Bound Standalone Lervo Node Distribution

- Status: accepted
- Decision date: 2026-08-22

## Context

`lervo-node` imported private workspace packages and could not run outside a checkout. Requiring npm publication would couple deployment validation to publication policy. Claude SDK resolves platform-, CPU-, and libc-specific native packages, so cross-built or universal claims would misrepresent the executable closure. Runtime configuration and secrets must remain separate.

## Decision

Bundle private runtime code into one ESM `dist/bin.js`. The only permitted non-builtin external is `@anthropic-ai/claude-agent-sdk`. A private `@lervo/node-runtime-dependencies` package pins exact Agent SDK, Anthropic SDK, MCP SDK, and Zod versions. On a trusted build host, assemble that external closure offline from the lockfile and local pnpm store.

Bind artifacts to the actual build OS, architecture, and, on Linux, `glibc|musl`. Build Linux/WSL archives there or on matching CI; an unexecuted cross-build is not support evidence.

The payload contains the bundle, exact production closure, a short README, minimal manifest, CycloneDX 1.7 SBOM, and `lervo-node-distribution.manifest.json`. The distribution manifest binds the runtime and Node versions, entrypoint, platform, every file and symlink, dependencies, and canonical digests. A sidecar binds the archive name, size, SHA-256, platform, and embedded-manifest hash, but is not a trust anchor. Consumers require an independently trusted exact archive SHA-256.

An install host requires only Node 22.13+ and tar—no registry, package manager, or checkout. `node:distribution:install` revalidates the expected SHA, manifest, SBOM, content, dependencies, and no-argument startup, and never overwrites. Build and install require `--write` and safe, absolute, new paths. They do not create services, configuration, or readiness.

Archives exclude repositories, configuration, credentials, trust/CA material, and events. Fixed errors distinguish bundle/native/platform, digest/archive/manifest/content/SBOM/dependency, smoke, and safe-target failures. Success does not prove a Hub, provider authentication, repository configuration, service, readiness, or command.

## Consequences

Tests reject schema, digest, and symlink attacks; rebuild content and native closure; verify native Claude entrypoints; install only with the correct SHA; and smoke outside a checkout. macOS arm64 and WSL2 Linux x64/glibc builds and installations were completed, including a 97,799,300-byte WSL archive, without claiming service or Hub readiness.

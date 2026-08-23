# ADR-0167: Platform-Bound Standalone Lervo Node Distribution

- Status: accepted
- Decision date: 2026-08-22

## Context

lervo-node imported private workspace packages and could not run outside a checkout. Requiring npm publication would couple deployment validation to publication policy. Claude SDK also resolves platform/CPU/libc native packages, so cross-built or universal claims would misstate the executable closure. Runtime configuration and secrets must remain separate.

## Decision

Private runtime code is bundled into one ESM dist/bin.js; the only permitted non-builtin external is @anthropic-ai/claude-agent-sdk. A private @lervo/node-runtime-dependencies package pins exact Agent SDK, Anthropic SDK, MCP SDK, and Zod versions. Offline deployment from lockfile/local pnpm store assembles that external closure on a trusted build host.

Artifacts bind the actual build os, arch, and Linux glibc|musl. Linux/WSL archives are built there or on matching CI; unexecuted cross-builds are not support evidence.

Payload includes bundle, exact production closure, short README, minimal manifest, CycloneDX 1.7 SBOM, and lervo-node-distribution.manifest.json. The manifest binds runtime/Node version, entrypoint, platform, all files/symlinks, dependencies, and canonical digests. A sidecar binds archive name/size/SHA-256, platform, and embedded-manifest hash but is not a trust anchor; consumers require an independently trusted exact archive SHA-256.

An install host needs Node 22.13+ and tar only—no registry, package manager, or checkout. node:distribution:install revalidates expected SHA, manifest, SBOM, content, dependencies, and no-argument startup, and never overwrites. Build/install require --write, safe absolute new paths, and do not create services/config/readiness.

Archives exclude repositories, config, credentials, trust/CA material, and events. Fixed errors distinguish bundle/native/platform, digest/archive/manifest/content/SBOM/dependency, smoke, and safe-target failures. Success proves no Hub, provider auth, repository configuration, service, readiness, or command.

## Consequences

Tests reject schema/digest/symlink attacks, rebuild content and native closure, verify native Claude entrypoints, install only with correct SHA, and smoke outside checkout. macOS arm64 and WSL2 Linux x64/glibc builds/installations were completed, including a 97,799,300-byte WSL archive, without claiming service or Hub readiness.

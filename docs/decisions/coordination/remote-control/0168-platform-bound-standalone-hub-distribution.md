# ADR-0168: Platform-Bound Standalone Lervo Hub Distribution

- Status: accepted
- Decision date: 2026-08-22

## Context

An always-on Hub must install independently of source checkout and npm publication. Existing output imported private workspaces, and executable archives must not bundle operational configuration or secrets.

## Decision

All private workspace and ordinary JavaScript dependencies are bundled into one ESM dist/bin.js with no non-builtin external imports. The artifact binds actual build os, arch, and Linux glibc|musl and makes no unexecuted platform claim.

Payload contains bundle, exact synchronously loaded web assets, minimal package manifest, short README, application-only CycloneDX 1.7 SBOM, and lervo-hub-distribution.manifest.json—no node_modules, source, tests, or workspace packages.

The embedded manifest binds runtime version, Node >=22.13, entrypoint, platform, every file/symlink size/mode/SHA-256, and canonical content digest. A sidecar binds archive name/size/hash and manifest hash; an independently trusted expected archive hash remains required.

Build/install require --write and safe absolute new output/target and never overwrite. Verify/install recheck archive, manifest, SBOM, content, current platform, startup outside checkout, and a real loopback listener using temporary owner-only config, keys, credentials, and state. Installation only places payload; it creates no config, secret, database/CAS, or service.

Archives exclude secrets, identities, certificates, storage, repository paths, and events. Fixed failures distinguish self-containment, digest/archive/manifest/content/SBOM/platform/smoke/target. Success alone proves no listener, storage, authentication, Node connection, service, or readiness.

## Consequences

Tests cover schema and stronger-claim forgery, archive path/digest mutation, macOS arm64 build/install/listener smoke, and a WSL2 Linux x64/glibc 166,752-byte archive with required assets and SHA-256 36a2426766bac204e8a1e8974665d97dba59859dae68912183cddf06b400e4f9. The WSL install reached loopback readiness with separately provisioned owner-only material; a missing-assets predecessor was quarantined. Signed provenance, updates, provisioning, and fleet rollout remain future work.

# ADR-0168: Platform-Bound Standalone Lervo Hub Distribution

- Status: accepted
- Decision date: 2026-08-22

## Context

An always-on Hub must install independently of a source checkout and npm publication. Existing output imported private workspaces, while executable archives must not contain operational configuration or secrets.

## Decision

Bundle every private workspace and ordinary JavaScript dependency into one ESM `dist/bin.js` with no non-builtin external imports. The artifact records the actual build OS and architecture and, on Linux, `glibc` or `musl`; it makes no claim about an unexecuted platform.

The payload contains:

- the bundle;
- the exact synchronously loaded web assets;
- a minimal package manifest;
- a short README;
- an application-only CycloneDX 1.7 SBOM; and
- `lervo-hub-distribution.manifest.json`.

It excludes `node_modules`, source, tests, and workspace packages.

The embedded manifest binds the runtime version, Node `>=22.13`, entrypoint, platform, and every file or symlink's size, mode, and SHA-256, plus a canonical content digest. A sidecar binds the archive name, size, hash, and manifest hash. An independently trusted expected archive hash remains required.

Build and install require `--write`, a safe absolute new output or target, and never overwrite. Verification and installation recheck the archive, manifest, SBOM, content, current platform, startup outside the checkout, and a real loopback listener using temporary owner-only config, keys, credentials, and state.

Installation places only the payload. It creates no config, secret, database, CAS, or service.

Archives exclude secrets, identities, certificates, storage, repository paths, and events. Fixed failures distinguish self-containment, digest, archive, manifest, content, SBOM, platform, smoke, and target errors. Success alone proves no listener, storage, authentication, Node connection, service, or readiness.

## Consequences

Tests cover schema and stronger-claim forgery, archive path and digest mutation, macOS arm64 build/install/listener smoke, and a WSL2 Linux x64/glibc 166,752-byte archive with required assets and SHA-256 `36a2426766bac204e8a1e8974665d97dba59859dae68912183cddf06b400e4f9`.

The WSL installation reached loopback readiness with separately provisioned owner-only material. A missing-assets predecessor was quarantined.

Signed provenance, updates, provisioning, and fleet rollout remain future work.

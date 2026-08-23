---
lervo:
  document:
    route: distribution
    filename: hub-runtime-distribution.md
---
# Lervo Hub standalone distribution

This directory is a platform-specific Lervo Hub distribution that runs without an npm registry or a Lervo source checkout.

- Entry point: `dist/bin.js`
- Required runtime: Node.js 22.13 or later
- Configuration, credentials, signing keys, TLS certificates, and the operational database are not included.
- `lervo-hub-distribution.manifest.json` and `sbom.cdx.json` are the verification sources for included files.
- A successful install does not prove listener startup, storage readiness, node connectivity, or service activation.

Obtain the archive SHA-256 through a separate trusted channel and compare the exact digest before installation. Extract into a new, previously absent directory, prepare separate owner-only configuration and cryptographic material, then activate explicitly with the service renderer and manager.

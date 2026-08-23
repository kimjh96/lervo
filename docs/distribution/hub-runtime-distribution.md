# Lervo Hub standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Configuration, credentials, signing keys, TLS certificates, and the operational database are not included.
- Verify included files against `lervo-hub-distribution.manifest.json` and `sbom.cdx.json`.
- Installation success does not prove listener startup, storage readiness, node connectivity, or service activation.

Obtain the archive SHA-256 through a separate trusted channel and compare the exact digest before installation. Extract the archive into a new, previously absent directory. Prepare owner-only configuration and cryptographic material separately, then activate the Hub explicitly with the service renderer and manager.

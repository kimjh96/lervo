# Lervo Node standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Version: the owning Lervo product release from the public `@lervo/cli` manifest
- Excludes configuration, bearer tokens, trust keys, CA certificates, and repositories.
- Verify included files and the dependency closure against `lervo-node-distribution.manifest.json` and `sbom.cdx.json`.
- Successful installation does not prove Hub connectivity, provider authentication, service activation, or readiness.

Obtain the archive SHA-256 through a separate trusted channel and compare it with the platform SHA-256 tool. Extract into a new, previously absent directory, then run `node dist/bin.js --config <config.json>`.

On a host containing the Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then explicitly activate the Node with the service renderer and manager.

Private workspace package versions are implementation coordinates, not operational Node release identifiers. The embedded package manifest, SBOM root, distribution manifest, and artifact sidecar must all match the public Lervo product version.

# Lervo Node standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Configuration, bearer tokens, trust keys, CA certificates, and repositories are not included.
- Verify included files and the dependency closure against `lervo-node-distribution.manifest.json` and `sbom.cdx.json`.
- Installation success does not prove Hub connectivity, provider authentication, service activation, or readiness.

Obtain the archive SHA-256 through a separate trusted channel and compare it with the platform SHA-256 tool. Extract the archive into a new, previously absent directory, then run `node dist/bin.js --config <config.json>`.

On a host containing the Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then activate the Node explicitly with the service renderer and manager.

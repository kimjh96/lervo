---
lervo:
  document:
    route: distribution
    filename: node-runtime-distribution.md
---
# Lervo Node standalone distribution

This directory is a platform-specific Lervo Node distribution that runs without an npm registry or a Lervo source checkout.

- Entry point: `dist/bin.js`
- Required runtime: Node.js 22.13 or later
- Configuration, bearer tokens, trust keys, CA certificates, and repositories are not included.
- `lervo-node-distribution.manifest.json` and `sbom.cdx.json` are the verification sources for included files and the dependency closure.
- A successful install does not prove Hub connectivity, provider authentication, service activation, or readiness.

Obtain the archive SHA-256 through a separate trusted channel and compare the exact digest with the platform SHA-256 tool. Extract into a new, previously absent directory and run `node dist/bin.js --config <config.json>`. On a host with the Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare separate owner-only configuration, then activate explicitly with the service renderer and manager.

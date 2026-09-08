# Lervo Node standalone distribution

Platform-specific distribution that runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Version: owning Lervo product release from the public `@lervo/cli` manifest
- Excludes: configuration, bearer tokens, trust keys, CA certificates, and repositories
- Verify included files and dependency closure against `lervo-node-distribution.manifest.json` and `sbom.cdx.json`.
- Successful installation does not prove Hub connectivity, provider authentication, service activation, or readiness.

## Deployment guides

- [Installation, preflight, service activation, and readiness](node-runtime-distribution/installation-and-readiness.md)
- [Discord configuration and behavior](node-runtime-distribution/discord-configuration.md)

The [Discord service decision](../decisions/coordination/conversations/0382-node-hosted-discord-conversation-service.md) and [routing decision](../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md) define Discord fields and failure behavior.

## Release identity

Private workspace package versions are implementation coordinates, not operational Node release identifiers. The embedded package manifest, SBOM root, distribution manifest, and artifact sidecar must all match the public Lervo product version.

# Lervo Node standalone distribution

Platform-specific distribution that runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`, importing the internal `dist/repository-runtime.js` module
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

## Native runtime assets

Darwin archives include source-bound universal synchronization and content-addressed storage (CAS) addons with their manifests in `dist/native/`. All four files are covered by the archive inventory and SBOM. Other targets omit these assets and retain ordinary I/O. Version-5 archives require the complete internal repository runtime inventory and its aggregate SBOM component. The version-1 `dist/repository-runtime.json` lists sorted names, sizes and SHA-256 hashes for the entry module and any private JS/CJS members. Code and manifest together are limited to 64 MiB, with at most 128 code files and a 64 KiB manifest. Verification rejects undeclared, absent, changed or redirected members. Upgrade the verifier/installer first; versions 1 through 4 retain their original read contracts. See [the bundle contract](cli-bundle-construction/build.md) and [ADR-0502](../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md). Compilation and downloads never occur at runtime or installation.

The CLI-installed Node launcher includes the complete inventory digest in its content address and copies the admitted files beside its entrypoint. Missing members can be repaired from the captured snapshot. Existing conflicts are checked before any missing member is written; conflicting bytes or symbolic links are rejected without overwriting them. The standalone build uses the same internal composition contract without the CLI command dispatcher. Neither artifact publishes a public SDK.

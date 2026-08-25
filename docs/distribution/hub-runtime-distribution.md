# Lervo Hub standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Configuration, credentials, signing keys, TLS certificates, and the operational database are excluded.
- Verify included files against `lervo-hub-distribution.manifest.json` and `sbom.cdx.json`.
- Installation success does not prove listener startup, storage readiness, node connectivity, or service activation.

Obtain the archive SHA-256 through a separate trusted channel and compare the exact digest before installation. Extract into a new, previously absent directory. Prepare owner-only configuration and cryptographic material separately, then activate the Hub explicitly with the service renderer and manager.

The Hub bundle has no external or native runtime imports. Release operators may therefore build a target-labelled archive from another host with `pnpm hub:distribution:build -- --output <absolute.tar.gz> --platform linux-x64-glibc --write`. The build still runs the configured Hub smoke test against the exact bundled bytes. Before writing the new installation, the target-side installer independently requires the declared OS, architecture, and libc to match.

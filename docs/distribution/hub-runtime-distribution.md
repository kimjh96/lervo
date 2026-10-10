# Lervo Hub standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Version: the owning Lervo product release from the public `@lervo/cli` manifest
- Excludes configuration, credentials, signing keys, TLS certificates, and the operational database.
- Verify included files against `lervo-hub-distribution.manifest.json` and `sbom.cdx.json`.
- Successful installation does not prove listener startup, storage readiness, node connectivity, or service activation.

Obtain the archive SHA-256 through a separate trusted channel and compare the exact digest before installation. Extract into a new, previously absent directory. Prepare owner-only configuration and cryptographic material separately, then explicitly activate the Hub with the service renderer and manager. Pass the installed `dist/bin.js` as `--executable` and a verified Node.js binary as `--node-executable`; the resulting service definition must not depend on an ambient `PATH` or externally maintained launcher.

On `SIGINT` or `SIGTERM`, the runtime immediately stops accepting requests and gives active HTTP responses 10 seconds to drain. At the deadline, it closes remaining connections so an abandoned client cannot indefinitely block service replacement. A fixed warning identifies the forced-drain disposition without exposing request or peer details. Cleanup and SQLite close still complete before the process exits successfully.

The Hub JavaScript bundle has no external package imports. Darwin distributions include source-bound universal synchronization and content-addressed storage (CAS) addons with both manifests in `dist/native/`; other targets omit the four files and retain ordinary I/O. Release operators may build a target-labelled archive on another host with `pnpm hub:distribution:build -- --output <absolute.tar.gz> --platform linux-x64-glibc --write`. The build still runs the configured Hub smoke test against the exact bundled bytes. Before writing the installation, the target-side installer independently requires the declared OS, architecture, and libc to match.

Private workspace package versions are implementation coordinates, not operational Hub release identifiers. The embedded package manifest, SBOM root, distribution manifest, and artifact sidecar must all match the public Lervo product version.

[ADR-0502](../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) defines native source/binary identity, SBOM binding and the version-3 archive contract. Use an updated verifier/installer for new archives; current tools continue to read version-1 and version-2 archives. A cross-host smoke does not prove target-native execution.

Windows verification accepts native tar line endings and compares the extracted read-only attribute rather than unavailable POSIX permission distinctions. Archive and manifest hashes still bind original mode declarations, and extracted content and membership remain exact. See the [target-platform qualification](../evidence/quality/context-quality/context-quality-platform-qualification.md) for observed Linux and Windows execution and remaining acceptance limits.

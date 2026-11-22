# ADR-0093: CLI release provenance-attestation boundary

Status: `accepted`  
Decision date: 2026-08-21  
Amended by: [ADR-0614](../packaging/0614-sign-the-verified-release-subjects.md) (`attested-cli` signs the subjects the matrix verified, and on reuse it follows `plan` alone)

## Context

The manifest and SBOM bind reviewed content, but not the procedure or identity that produces the tarball. Repeated `pnpm pack` runs can change tar bytes through metadata, making repository-pinned tar digests stale. Local code also cannot credibly assert trusted CI identity.

## Decision

Use in-toto Statement v1 with SLSA provenance v1 for three per-run SHA-256 subjects: `lervo-cli-<version>.tgz`, the release manifest, and the release SBOM. Do not commit per-run statements or bundles.

### Local unsigned statement

- `release:attestation:check` revalidates the manifest and SBOM, builds a temporary tarball, creates and revalidates a statement, and deletes every temporary file. The statement covers the three subjects plus digests for the package manifest, package README, bundle, release manifest, SBOM, and lockfile.
- Use repository-relative input names, builder `urn:lervo:builder:local-unsigned:v1`, build type `urn:lervo:build-type:cli-release:v1`, no external parameters, internal Node/pnpm/OS/architecture values, and no time or invocation ID.
- `:local` prints the same unsigned statement and rejects DSSE or signature fields. It supports digest review, not authenticated provenance or a SLSA level.
- `:prepare <absolute-new-directory>` copies only verified subjects and never overwrites. CI additionally requires the exact `v<package-version>` tag.

### GitHub signing

- Keep the normal OS matrix contents-read and running unsigned checks.
- Run a separate `attested-cli` job only after every matrix job and an explicit tag workflow dispatch. Grant `id-token`, `attestations`, and `artifact-metadata` write only to that job.
- Rebuild on Ubuntu, revalidate the manifest, SBOM, and tag, prepare the exact subjects, then use pinned `actions/attest` to create GitHub OIDC SLSA provenance and a separate CycloneDX SBOM attestation for the same tarball.
- Verify both immediately under ADR-0094, then upload release files and bundles for 30 days.
- Never describe workflow structure or local success as a remote signature that has not executed.

Use bounded `release_attestation_*` failure codes for invalid input, statement, mismatch, unexpected envelope, arguments, identity, output, tag, and check failures. Default errors reveal no subordinate output, temporary paths, or credentials. Add no runtime event or state.

## Consequences

Local checks are reproducible and unsigned. Elevated CI authority is isolated to the tag job, which binds the tarball, manifest, and SBOM. This does not prove execution of a future job, artifact retention, npm publication, or a SLSA level.

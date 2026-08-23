# ADR-0093: CLI release provenance-attestation boundary

Status: `accepted`
Decision date: 2026-08-21

## Context

Manifest/SBOM bind reviewed content but not the procedure or identity producing the actual tarball. Repeated `pnpm pack` can change tar bytes through metadata, so repository-pinned tar digests become stale; local code also cannot self-assert trusted CI identity.

## Decision

Use in-toto Statement v1 and SLSA provenance v1 over three per-run SHA-256 subjects: `lervo-cli-<version>.tgz`, release manifest, and release SBOM. Commit no per-run statement/bundle.

### Local unsigned statement

- `release:attestation:check` revalidates manifest/SBOM, builds a temporary tarball, creates and revalidates a statement over three subjects plus package manifest, package README, bundle, release manifest, SBOM, and lockfile digests, then deletes all temporary files.
- Use repository-relative input names, builder `urn:lervo:builder:local-unsigned:v1`, build type `urn:lervo:build-type:cli-release:v1`, no external parameters, internal Node/pnpm/OS/architecture, and no time/invocation ID.
- `:local` prints the same unsigned statement and rejects any DSSE/signature fields. It is digest review, not authenticated provenance or SLSA level.
- `:prepare <absolute-new-directory>` copies only verified subjects and never overwrites. CI also requires exact `v<package-version>` tag.

### GitHub signing

- Normal OS matrix remains contents-read and runs unsigned checks.
- A separate `attested-cli` job runs only after all matrix jobs and explicit tag workflow dispatch, with only that job receiving `id-token`, `attestations`, and `artifact-metadata` write.
- Rebuild on Ubuntu, revalidate manifest/SBOM/tag, prepare exact subjects, then let pinned `actions/attest` create GitHub OIDC SLSA provenance and a separate CycloneDX SBOM attestation for the same tarball.
- Immediately verify both under ADR-0094, then upload release files/bundles for 30 days.
- Never present workflow-structure/local success as an unexecuted remote signature.

Failures use bounded `release_attestation_*` codes for invalid input/statement/mismatch/unexpected envelope/arguments/identity/output/tag/check. Default errors expose no subordinate output, temporary paths, or credentials. Add no runtime event/state.

## Consequences

Local checks remain reproducible and unsigned; elevated CI authority is isolated to the tag job, which binds tarball/manifest/SBOM. This does not prove an unexecuted job, artifact retention, npm publication, or a SLSA level.

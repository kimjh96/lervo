# ADR-0094: Consumer verification of CLI release attestations

Status: `accepted`  
Decision date: 2026-08-21

## Context

A bundle's existence does not prove delivered bytes or exact repository, workflow, tag, and commit identity. A tag name does not detect tag movement, and a signed predicate does not replace certificate identity. Local unsigned statements are not trust evidence. CycloneDX also requires a deterministic UUIDv5 serial for recognition by pinned `actions/attest`.

## Decision

- Separate provider-neutral statement policy, the GitHub verifier adapter, and file-lifecycle validation.
- Delegate cryptography, certificates, trusted roots, and transparency timestamps to `gh attestation verify`, then independently validate its successful statement JSON.
- Require the consumer to supply an absolute release directory, exact `owner/repository`, `v<package-version>` tag, 40- or 64-hex source commit, and optionally a separately obtained trusted root.
- For provenance and SBOM bundles, require the exact repository, GitHub token issuer, workflow certificate identity at the tag ref, source ref and digest, signer workflow digest, GitHub-hosted runner, and expected SLSA-v1 or CycloneDX predicate type.
- Use exact `--cert-identity`, never partial workflow matching. An optional absolute trusted root enables custom offline verification; acquiring and updating that root remains the consumer's responsibility.
- Permit only the tarball, manifest, SBOM, and `attestations` in the release root, and only provenance and SBOM bundles in the bundle directory. Reject symlinks and empty, oversized, extra, or missing files.
- Compare version, tag, and snapshot bytes before verification. Reread release files, bundles, and any custom root afterward, rejecting changes.
- Require the provenance subject set to exactly equal the three delivered basenames and digests. The SBOM subject must be exactly the tarball, and its signed CycloneDX predicate must semantically equal the delivered SBOM.
- Require exactly one attestation and certificate, plus at least one verified timestamp, in each verifier result. Reject local-builder unsigned input before invoking the verifier.
- Return bounded v1 JSON only after both bundles and all added policies pass. Write nothing.
- Before upload, run this command in the tag job with repository, ref, SHA, and a limited GH token.

Use bounded failure codes for arguments, input, trust, release set, unsigned input, signature, verifier output, statement subject, predicate, change, and general verification. Default output reveals no verifier stderr, bundle or certificate source, credentials, or paths.

## Consequences

Consumers can verify bytes, predicate relationships, and exact GitHub workload identity, including the immovable source digest. Cryptography remains adapter-local. Fixtures and workflow structure do not prove future remote signing, retention, npm publication, code review, or a SLSA level.

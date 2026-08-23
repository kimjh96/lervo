# ADR-0094: Consumer verification of CLI release attestations

Status: `accepted`
Decision date: 2026-08-21

## Context

Bundle existence does not prove delivered bytes or exact repository/workflow/tag/commit identity. Tag name alone misses tag movement; signed predicate cannot replace certificate identity. Local unsigned statements are not trust evidence. CycloneDX also needs deterministic UUIDv5 serial for pinned `actions/attest` recognition.

## Decision

- Separate provider-neutral statement policy, GitHub verifier adapter, and file-lifecycle validation.
- Delegate cryptography/certificates/trusted root/transparency timestamps to `gh attestation verify`; independently validate its successful statement JSON.
- Consumer explicitly supplies absolute release directory, exact `owner/repository`, `v<package-version>` tag, 40/64-hex source commit, and optional separately obtained trusted root.
- For provenance and SBOM bundles require exact repository, GitHub token issuer, exact workflow certificate identity at tag ref, exact source ref/digest and signer workflow digest, GitHub-hosted runner, and expected SLSA-v1 or CycloneDX predicate type.
- Use exact `--cert-identity`, not partial workflow matching. Optional absolute trusted root maps to custom offline verification; root acquisition/update remains consumer responsibility.
- Release root contains only tarball/manifest/SBOM/`attestations`; bundle directory only provenance/SBOM bundles. Reject symlinks, empty/oversized/extra/missing files.
- Compare version/tag and snapshot bytes before verification; reread release files, bundles, and custom root afterward and reject change.
- Provenance subject set must exactly equal delivered three basenames/digests. SBOM subject is exactly tarball, and signed CycloneDX predicate semantically equals delivered SBOM.
- Require exactly one attestation, certificate, and at least one verified timestamp per verifier result. Reject local builder unsigned input before invoking verifier.
- CLI verification returns bounded v1 JSON only when both bundles and added policies pass; writes nothing.
- Tag job runs this command with repository/ref/SHA and limited GH token before uploading.

Use bounded failure codes for arguments/input/trust/release set/unsigned/signature/verifier output/statement subject/predicate/change/general verification. Default output exposes no verifier stderr, bundle/certificate source, credential, or paths.

## Consequences

Consumers verify bytes, predicate relationships, and exact GitHub workload identity including immovable source digest. Crypto remains adapter-local. Fixtures/workflow structure do not prove future remote signing, retention, npm publication, code review, or SLSA level.

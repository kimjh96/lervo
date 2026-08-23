# ADR-0095: CLI release publication eligibility and authority boundary

Status: `accepted`
Decision date: 2026-08-21

## Context

Verified signed release files do not determine npm target/version/tag, and a changed tarball after verification could be published. Read-only readiness must not hold registry-write credentials. Repository URL, `@lervo` ownership, and Trusted Publisher were unverified and cannot be invented.

## Decision

- `release:publication:authorize` reruns consumer attestation verification and writes one new, non-overwriting JSON outside the repository.
- V1 binds `status=eligible`, public npm/access, exact package/version, explicit `latest`/`next`, tar basename/SHA-256, expected npm SHA-512 integrity/SHA-1 shasum, verified repository/workflow/tag/commit/three subjects, and canonical authorization digest.
- `eligible` means coordinates match verified release policy—not human approval, namespace ownership, publisher setup, reachability, or publication.
- Core reader revalidates eligibility and tarball, recalculates all three digests immediately before narrow publish port, verifies exact registry/package/version/tag/digests in receipt, and rereads tarball afterward. Core knows no npm/GitHub environment.
- Trusted-publishing adapter requires GitHub-hosted Actions/OIDC, Node ≥22.14, npm ≥11.5.1, rejects long-lived token/auth config, uses isolated empty npm configs/cache/cwd, publishes exact tar with public access/tag and no lifecycle scripts, then verifies public metadata and cleans up.
- Tag attestation job creates/stores temporary eligibility only; it does not add npm publish/environment. Default readiness later restricts activation to staged publishing, leaving this direct adapter inactive unless separately authorized.
- Add no runtime event/state.

Fixtures reject digest/tag/unverified/tar mutation, tokens, old tools, and registry receipt mismatch. Verdaccio remains ADR-0091. No real GitHub/npm publish is claimed.

## Consequences

Signed verification, publication coordinates, and external write authority are separate and cannot be conflated with actual publication approval/success.

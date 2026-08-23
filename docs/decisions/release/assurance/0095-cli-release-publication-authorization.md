# ADR-0095: CLI release publication eligibility and authority boundary

Status: `accepted`  
Decision date: 2026-08-21

## Context

Verified signed release files do not determine the npm target, version, or tag, and a tarball changed after verification could be published. Read-only readiness must not hold registry-write credentials. Repository URL, `@lervo` ownership, and Trusted Publisher configuration were unverified and must not be invented.

## Decision

- `release:publication:authorize` reruns consumer attestation verification and exclusively writes one new JSON file outside the repository, without overwriting.
- V1 binds `status=eligible`, public npm and access, exact package and version, explicit `latest` or `next`, tar basename and SHA-256, expected npm SHA-512 integrity and SHA-1 shasum, verified repository, workflow, tag, commit, and three subjects, plus a canonical authorization digest.
- `eligible` means the coordinates satisfy verified release policy. It does not mean human approval, namespace ownership, publisher setup, reachability, or successful publication.
- The core reader revalidates eligibility and the tarball, recalculates all three digests immediately before the narrow publish port, verifies the exact registry, package, version, tag, and digests in the receipt, and rereads the tarball afterward. Core knows no npm or GitHub environment.
- The trusted-publishing adapter requires GitHub-hosted Actions/OIDC, Node ≥22.14, and npm ≥11.5.1. It rejects long-lived tokens and auth configuration; uses isolated empty npm configs, cache, and cwd; publishes the exact tarball with public access and the selected tag, without lifecycle scripts; verifies public metadata; and cleans up.
- The tag attestation job creates and stores temporary eligibility only. It adds no npm publication or environment. Default readiness later restricts activation to staged publishing, so this direct adapter remains inactive unless separately authorized.
- Add no runtime event or state.

Fixtures reject digest, tag, verification, or tar mutations; tokens; obsolete tools; and registry-receipt mismatches. Verdaccio remains governed by ADR-0091. No real GitHub or npm publication is claimed.

## Consequences

Signed verification, publication coordinates, and external write authority remain separate and cannot be conflated with actual publication approval or success.

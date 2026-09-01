# ADR-0330: Release-bound standalone runtime version

Status: accepted
Date: 2026-09-01

## Context

Standalone Hub and Node distributions used private workspace package versions as operational runtime identities. Those packages intentionally remain internal implementation coordinates at `0.1.0`, while the reviewed Lervo product release was `0.8.1`. A newly rebuilt and deployed Hub therefore reported `0.1.0`, which did not identify the Lervo release that produced its bytes. Repository Node rollout state separately reported the operator-supplied product version, giving the same `runtimeVersion` field two meanings.

## Decision

- The public `@lervo/cli` manifest is the product release coordinate for the CLI and standalone Hub and Node distributions built from the same source revision.
- Hub and Node distribution builders read that coordinate through one shared, validated release-version boundary and reject a private, renamed, or non-stable CLI manifest.
- Embedded package manifests, SBOM roots, distribution manifests, and artifact sidecars receive the same product release version.
- Release-intent inspection covers standalone builders, verifiers, installers, copied Hub assets, and Hub and Node workspace dependency closures. A changed operational artifact cannot remain hidden behind a private package coordinate.
- Private workspace package versions remain implementation coordinates. They are not exposed as standalone runtime identity or independently advanced for this purpose.
- Build verification must prove before deployment that standalone artifacts contain the current product release coordinate. Runtime readiness and Node connectivity remain separate observations.

## Consequences

A Hub or Node distribution identifies the Lervo release that produced it without relying on an installation-directory digest or deployment conversation. Rebuilding after release preparation picks up the prepared version. A future independent Hub or Node release train requires a new public-package and compatibility decision instead of silently reusing private workspace versions.

## Verification

Focused tests cover the public release-version resolver and invalid manifest coordinates. Existing standalone distribution smoke tests verify the embedded manifest, minimal package manifest, SBOM root, artifact sidecar, archive digest, installation, and listener behavior using the resolved version.

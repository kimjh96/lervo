# ADR-0330: Release-bound standalone runtime version

Status: accepted
Date: 2026-09-01

## Context

The standalone Hub and Node distributions used the versions of their private workspace packages as operational runtime identities. Those packages intentionally remain internal implementation coordinates at `0.1.0`, while the only reviewed Lervo product release was already `0.8.1`. A freshly rebuilt and deployed Hub therefore reported `0.1.0`, which could not identify the Lervo release that produced its bytes. Repository Node rollout state separately reported the operator-supplied product version, creating two meanings for the same `runtimeVersion` field.

## Decision

- The public `@lervo/cli` manifest is the product release coordinate for the CLI and the standalone Hub and Node distributions produced from the same source revision.
- Hub and Node distribution builders read that coordinate through one shared, validated release-version boundary. They reject a private, renamed, or non-stable CLI manifest.
- Embedded package manifests, SBOM roots, distribution manifests, and artifact sidecars all receive the same product release version.
- Release-intent inspection includes the standalone builders, verifiers, installers, copied Hub assets, and the Hub and Node workspace dependency closures. A changed operational artifact cannot remain hidden behind a private package coordinate.
- Private workspace package versions remain implementation coordinates. They are not exposed as standalone runtime identity and are not independently advanced for this purpose.
- Build verification must prove that standalone artifacts contain the current product release coordinate before deployment. Runtime readiness and Node connectivity remain separate observations.

## Consequences

A Hub or Node distribution now answers which Lervo release produced it without relying on an installation-directory digest or deployment conversation. Rebuilding after release preparation naturally picks up the prepared version. A future independent Hub or Node release train would require a new public-package and compatibility decision rather than silently reusing private workspace versions.

## Verification

Focused tests cover the public release-version resolver and invalid manifest coordinates. Existing standalone distribution smoke tests verify the embedded manifest, minimal package manifest, SBOM root, artifact sidecar, archive digest, installation, and listener behavior using the resolved version.

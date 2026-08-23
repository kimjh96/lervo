# ADR-0092: CLI release SBOM contract

Status: `accepted`
Decision date: 2026-08-20

## Context

The internal release manifest was not a standard SBOM, and lockfile-only conversion misses bundled workspace/external packages. Reinstalling during generation would vary by registry/platform, while time/random serials make identical sources non-reproducible.

## Decision

- Maintain one replace-in-place CycloneDX 1.7 JSON sidecar at `apps/cli/release-sbom.cdx.json`, excluded from npm archive. Only update command rewrites; checks are read-only.
- Combine production dependency graph rooted at CLI lockfile importer with workspace/external bundle packages bound by esbuild metafile/release manifest.
- Traverse only dependencies/optionalDependencies, not dev. Mark portable nodes required and eight Claude native variants optional. Convert every lockfile SHA-512 integrity to hex.
- Represent bundled workspaces separately; merge bundled property onto external packages also in lock graph; include bundle-only packages after lockfile integrity validation.
- Do not invent workspace-internal graph; state `lervo:release:workspace-relationships=not-asserted`.
- Root application uses npm PURL, bundle SHA-256, current license state, and release/bundle/portable-closure digests.
- Sort components/dependencies by PURL. Omit timestamp and arbitrary serial. Derive deterministic RFC 4122 UUIDv5 serial from canonical document digest; version remains 1. Infer no dependency licenses.
- Validate release manifest first, required/optional/root dependencies against approved sources, external bundle inventory, then exact committed SBOM equality. CI needs no remote schema; official CycloneDX schema validates the format separately.
- Add no runtime event/state.

## Consequences

Standard tools can read reproducible inventory/graph without changing the archive. It proves source-consistent components—not vulnerabilities, license compliance, internal calls, published provenance/signature, or remote-platform success.

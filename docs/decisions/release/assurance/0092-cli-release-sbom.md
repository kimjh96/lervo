# ADR-0092: CLI release SBOM contract

Status: `accepted`  
Decision date: 2026-08-20

## Context

The internal release manifest was not a standard SBOM. Lockfile-only conversion omits bundled workspace and external packages; reinstalling makes generation registry- and platform-dependent; timestamps and random serials prevent reproducibility.

## Decision

- Maintain one replace-in-place CycloneDX 1.7 JSON sidecar at `apps/cli/release-sbom.cdx.json`; exclude it from the npm archive. Only the update command may rewrite it; checks are read-only.
- Combine the production dependency graph rooted at the CLI lockfile importer with workspace and external bundle packages identified by the esbuild metafile/release manifest.
- Traverse `dependencies` and `optionalDependencies`, never development dependencies. Mark portable nodes required and the eight Claude native variants optional. Convert every lockfile SHA-512 integrity value to hex.
- Represent bundled workspaces separately. Add the bundled property to external packages also present in the lock graph, and include bundle-only packages only after lockfile integrity validation.
- Do not invent workspace-internal relationships; set `lervo:release:workspace-relationships=not-asserted`.
- Give the root application an npm PURL, bundle SHA-256, current license state, and release, bundle, and portable-closure digests.
- Sort components and dependencies by PURL. Omit timestamps and arbitrary serials. Derive a deterministic RFC 4122 UUIDv5 serial from the canonical document digest; keep version 1. Do not infer dependency licenses.
- Validate, in order, the release manifest; required, optional, and root dependencies against approved sources; the external bundle inventory; and exact equality with the committed SBOM. CI does not require a remote schema; validate the format separately with the official CycloneDX schema.
- Add no runtime event or state.

## Consequences

Standard tools can consume a reproducible inventory and graph without changing the archive. The SBOM proves source-consistent components, but not vulnerabilities, license compliance, internal calls, published provenance or signatures, or success on remote platforms.

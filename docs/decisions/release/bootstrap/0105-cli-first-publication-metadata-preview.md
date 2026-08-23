# ADR-0105: CLI first-publication metadata decision and write-free preview

Status: `accepted`
Decision date: 2026-08-21

## Context

Blocker reporting did not choose repository, license, or scope owner, nor show exact field changes. Immediate writes would combine decision review, source comparison, and apply authority. The release manifest is generated and must be regenerated rather than patched manually.

## Decision

Add `release:bootstrap:metadata-preview` with repository, a bounded non-UNLICENSED license, scope-owner kind, exact scope owner `lervo`, and optional JSON output.

Normalize decision v1 as preview-only, without approval, scope-control confirmation, or package-availability observation. Repository input is bounded GitHub coordinates. License validation checks formatting only, not SPDX validity or legal suitability.

Using package and release snapshots, require the existing package identity, version, and public access to be valid. Compare only `repository`, `license`, `publishConfig.registry`, and `publishConfig.provenance`. Emit only missing or different fields, with the `set` source and new value; never expose the previous value.

Never patch the release manifest. If the package changes or generated metadata differs, require `regenerate_after_package_metadata_update` and forbid direct patching.

Overall status is changes-required or no-local-changes, but remains advisory with activation unimplemented. External license approval, name observation, scope control, and first-publication approval remain required even when no local changes exist. Bind the decision, sources, changes, regeneration requirements, external requirements, and effects; reconstruct them in the reader.

Write nothing and provide no writer, generator, online, approval, reservation, or publisher port. Default English output hides digests, paths, and old values. Reject invalid arguments before reads.

## Consequences

The exact intended metadata decision is reviewable without changing source. ADR-0106 produces candidate bytes.

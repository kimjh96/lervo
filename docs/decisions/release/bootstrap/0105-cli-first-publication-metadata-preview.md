# ADR-0105: CLI first-publication metadata decision and write-free preview

Status: `accepted`
Decision date: 2026-08-21

## Context

Blocker reporting did not choose repository/license/scope owner or show exact field changes. Immediate writes would merge decision review, source comparison, and apply authority. Release manifest is generated and must be regenerated, not hand-patched.

## Decision

Add `release:bootstrap:metadata-preview` with repository, non-UNLICENSED bounded license, scope-owner kind, exact scope owner `lervo`, and optional JSON.

Normalize decision v1 as preview-only with no approval, scope-control confirmation, or package-availability observation. Repository is bounded GitHub coordinates; license validation is formatting only, not SPDX/legal review.

Using package/release snapshots, require existing package identity/version/public access already valid and compare only `repository`, `license`, `publishConfig.registry`, and `publishConfig.provenance`. Emit only missing/different plus `set` source/new value; expose no previous value.

Never patch release manifest. If package changes or generated metadata differs, require `regenerate_after_package_metadata_update` with direct patch forbidden.

Overall is changes-required/no-local-changes but remains advisory and activation unimplemented. External license approval, name observation, scope control, and first-publish approval stay required even with no local changes. Bind decision/source/change/regeneration/requirements/effects and reconstruct in reader.

Write nothing and provide no writer/generator/online/approval/reservation/publisher port. Default English output hides digests/paths/old values; reject bad arguments before reads.

## Consequences

The exact intended metadata decision is reviewable without changing source; ADR-0106 produces candidate bytes.

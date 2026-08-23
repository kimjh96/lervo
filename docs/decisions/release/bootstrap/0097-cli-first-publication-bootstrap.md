# ADR-0097: CLI first-publication bootstrap contract

Status: `accepted`; ADR-0111 replaces v1 input/result with evidence-report-based v2
Decision date: 2026-08-21

## Context

Public npm 404 proves only public absence, not private absence or scope ownership. Staged publishing/Trusted Publisher require an existing package, so first publication needs a one-time boundary that cannot leak direct publish authority into steady state. Human approval must bind exact release bytes/identity.

## Decision

V1 `release:bootstrap:authorize` revalidates publication authorization/tarball, manifest v5/current package, separate human approval JSON, and explicit online anonymous public-registry observation.

Manifest v5 binds repository, publish registry, and provenance; bootstrap requires exact GitHub repository, public npm, settled license, and enabled provenance. Metadata changes force regenerated manifest/SBOM/attestation/eligibility.

Approval v1 binds ID, approval/≤24-hour expiry times, approver, package/repository/license/scope owner, and publication digest, explicitly confirming license, public-name availability, scope control, one-time direct publish, and required stage-only transition. Result keeps only approval ID/digest. This proves content binding, not approver identity or npm authority.

Anonymous adapter classifies public endpoint as `not_found`, `existing`, or `unavailable`, storing no body. Accept only `not_found` observed within ten minutes and phrase it as public-package absence.

Result `bootstrap_authorized` binds target, release/approval digests, observation, and constraints: manual interactive once, recheck absence immediately before publish, 2FA presence, no reuse, transition to exact staged workflow/environment/permission, then forbid direct publish.

Command reads no npm credential, publishes/configures nothing, writes only a new absolute-path output with exclusive creation, and adds no project/event state.

## Consequences

Unresolved metadata correctly blocks bootstrap. Fixtures never prove scope ownership, private absence, 2FA, or successful first publication.

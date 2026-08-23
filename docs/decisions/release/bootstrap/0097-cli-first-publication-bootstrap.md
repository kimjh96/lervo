# ADR-0097: CLI first-publication bootstrap contract

Status: `accepted`; ADR-0111 replaces v1 input/result with evidence-report-based v2  
Decision date: 2026-08-21

## Context

A public npm 404 proves only public absence, not private absence or scope ownership. Staged publishing and Trusted Publisher require an existing package, so the first publication needs a one-time boundary that cannot leak direct-publish authority into steady state. Human approval must bind the exact release bytes and identity.

## Decision

V1 `release:bootstrap:authorize` revalidates the publication authorization and tarball, manifest v5 and the current package, a separate human-approval JSON document, and an explicit online anonymous observation of the public registry.

Manifest v5 binds the repository, publish registry, and provenance. Bootstrap requires the exact GitHub repository, public npm, a settled license, and enabled provenance. Metadata changes require regeneration of the manifest, SBOM, attestation, and eligibility.

Approval v1 binds an ID; approval and expiry times no more than 24 hours apart; approver; package, repository, license, and scope owner; and publication digest. It explicitly confirms the license, public-name availability, scope control, one-time direct publication, and required transition to stage-only operation. The result retains only the approval ID and digest. This proves content binding, not approver identity or npm authority.

The anonymous adapter classifies the public endpoint as `not_found`, `existing`, or `unavailable` and stores no response body. Accept only `not_found` observed within ten minutes, described as public-package absence.

The `bootstrap_authorized` result binds the target, release and approval digests, observation, and these constraints: one manual interactive use; absence rechecked immediately before publication; 2FA present; no reuse; transition to the exact staged workflow, environment, and permission; and direct publication forbidden afterward.

The command reads no npm credential, publishes and configures nothing, writes only a new absolute-path output using exclusive creation, and adds no project or event state.

## Consequences

Unresolved metadata blocks bootstrap. Fixtures do not prove scope ownership, private absence, 2FA, or successful first publication.

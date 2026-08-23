# ADR-0104: CLI first-publication activation blocker report

Status: `accepted`
Decision date: 2026-08-21

## Context

The plan showed order and risk but did not distinguish locally fixable blockers from externally verified ones. Publisher readiness assumes a repository and steady-state settings and cannot decide unresolved repository or scope ownership for first publication.

## Decision

Add `release:bootstrap:blockers [--json]`. It reads only bounded regular CLI-package and release-manifest files and rechecks unchanged bytes before output.

V1 is always `blocked`, with activation not implemented and advisory-only status. It reports these local checks as ready or blocked with controlled reasons:

- Package identity and public access.
- A matching valid GitHub repository.
- A matching non-UNLICENSED license.
- The public npm registry with explicit provenance.

Only a matching valid repository and license appear as targets. Bind both source digests and the checks. The reader reconstructs the report and rejects redigested forgery.

Separately list these external facts as `required`:

- Online public-name availability.
- Human confirmation of actual `@lervo` scope control.
- Separate approval binding the license, name, scope, one-time publication, and stage transition.

`required` means unobserved, not failed or absent. Even when every local check is ready, the result remains blocked because external facts and activation are outstanding.

Default English output separates local changes from external confirmation. A successful query exits 0, so consumers must inspect status. Reject unsupported or online arguments before reading sources. Provide no online, approval, patch, reservation, or publisher port. Bind that metadata was not changed, and write no result, event, or state.

## Consequences

Blockers are visible without selecting values or mutating metadata. ADR-0105 previews an explicit decision.

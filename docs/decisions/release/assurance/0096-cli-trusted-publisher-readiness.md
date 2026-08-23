# ADR-0096: CLI Trusted Publisher readiness contract

Status: `accepted`
Decision date: 2026-08-21

## Context

Eligibility alone does not prove package identity, namespace, Trusted Publisher, or protected GitHub environment. Readiness must be read-only and distinguish unknown external state. npm cannot preconfigure Trusted Publisher/staged publishing for a package not yet public, so first publication differs from steady-state publication.

## Decision

- `release:publisher:readiness --repository <owner/repo>` reads local sources by default; `--online` explicitly enables read-only npm/GitHub adapters.
- V1 reports in fixed order: package identity, inactive publish-job boundary, npm write access, npm Trusted Publisher, GitHub `npm-release` environment. Each is ready/blocked/unknown; overall ready only if all ready. Return stdout-only content-bound report with controlled reasons and no external bodies.
- Local identity requires exact package/public access/settled license/repository/public registry/provenance. `UNLICENSED`, absent/mismatched metadata, or active publish job blocks. Readiness never changes workflow.
- npm first anonymously checks public metadata. A 404 yields `public_package_not_found`, blocked public access and unknown trust, proving no private-package fact and invoking no credential/client.
- Only for public package, require npm ≥11.15 and exact registry `npm trust list`; retain only provider/repository/workflow/environment/permission, discarding trust/reviewer details.
- Steady-state publisher must bind exact workflow, `npm-release`, and only `createStagedPackage`; reject direct/broader permission. Maintainer separately reviews/2FA-approves staged package.
- GitHub reads environment/branch policies only and requires at least one reviewer, no self-review, and exactly one `v*` tag policy; reject truncated/ambiguous responses.
- Authentication/client/response/not-run stays unknown and exposes no tokens/responses/identities/paths. Mutate no npm/GitHub/workflow/project/event state.

## Consequences

Readiness cannot infer unobserved external configuration. A nonexistent public package blocks steady-state and routes to separate bootstrap.

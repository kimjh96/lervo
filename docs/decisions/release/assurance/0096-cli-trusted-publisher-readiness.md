# ADR-0096: CLI Trusted Publisher readiness contract

Status: `accepted`  
Decision date: 2026-08-21

## Context

Eligibility does not prove package identity, namespace control, Trusted Publisher configuration, or a protected GitHub environment. Readiness must be read-only and represent unknown external state. Because npm cannot configure Trusted Publisher or staged publishing before a package is public, first publication differs from steady-state publication.

## Decision

- `release:publisher:readiness --repository <owner/repo>` reads local sources by default. `--online` explicitly enables read-only npm and GitHub adapters.
- V1 reports, in fixed order, package identity, inactive publish-job boundary, npm write access, npm Trusted Publisher, and GitHub `npm-release` environment. Each item is `ready`, `blocked`, or `unknown`; the overall result is ready only when all items are ready. Return a stdout-only, content-bound report with controlled reasons and no external response bodies.
- Local identity requires the exact package, public access, settled license, repository, public registry, and provenance. `UNLICENSED`, missing or mismatched metadata, or an active publish job blocks readiness. Readiness never changes the workflow.
- First query public npm metadata anonymously. A 404 produces `public_package_not_found`, blocks public access, leaves trust unknown, proves no private-package fact, and invokes no credential or client.
- Only for a public package, require npm ≥11.15 and exact-registry `npm trust list`. Retain only provider, repository, workflow, environment, and permission; discard trust and reviewer details.
- The steady-state publisher must bind the exact workflow and `npm-release` environment with only `createStagedPackage`; reject direct or broader permission. A maintainer separately reviews and 2FA-approves the staged package.
- GitHub reads only environment and branch policies. Require at least one reviewer, disabled self-review, and exactly one `v*` tag policy; reject truncated or ambiguous responses.
- Authentication, client, response, or not-run failures remain unknown and expose no tokens, responses, identities, or paths. Mutate no npm, GitHub, workflow, project, or event state.

## Consequences

Readiness cannot infer external configuration it did not observe. A missing public package blocks steady-state operation and routes to the separate bootstrap process.

# ADR-0111: CLI first-publication bootstrap v2 evidence binding

Status: `accepted`; ADR-0112 adds short-lived exact-plan arming
Decision date: 2026-08-21

## Context

Bootstrap v1 separately interpreted one approval containing license, name, scope, and publication decisions. ADR-0110 split these into independent sources and an external-evidence report. Reinterpreting the human documents in both layers could diverge. Because v0 needs no operational compatibility, accepting v1 would bypass the stronger boundary.

## Decision

- In `release:bootstrap:authorize`, replace `--approval` with absolute `--external-evidence`.
- Snapshot the package, release manifest, publication authorization, evidence, and exact tarball. Independently validate the evidence schema, digest, target, expiry, fixed limitations, and no-effects declaration. Match its authorization, artifact, source, package, repository, and license to the current release.
- Only after local validation, call anonymous npm once. If the result is an exact public 404, create bootstrap v2, verify that every input byte remains unchanged, and exclusively write a new absolute output.
- Do not reread or reinterpret license, scope, or first-publication source documents. Accept evidence only when it declares the unverified receipt issuer, unauthenticated humans, non-registry scope attestation, unknown private absence, and lack of release-byte verification at the evidence stage.
- Bootstrap closes the final limitation by revalidating the exact tarball and authorization, but it does not upgrade the other four limitations.
- V2 retains target, identity, release, execution, and transition fields. Replace `approval` with evidence-report, post-apply, receipt, license, scope, and first-approval digests and times. Include no actors, bodies, paths, credentials, npm bodies, or errors.
- A fresh npm observation lasts ten minutes. Bootstrap expires at the earlier of that deadline and the evidence expiry. Retain manual interactive one-time publish, prohibit reuse, and require the stage-only transition.
- Reject bootstrap v1 as `first_publication_bootstrap_schema_unsupported` and reject old `--approval` before reading sources. Migration requires collecting current evidence and issuing a new bootstrap; never convert automatically.
- Add no credential, approval, reservation, arming, publication, settings, event, or state.

## Consequences

External evidence, exact-release freshness, and the CLI file/online lifecycle each have one owner. Every downstream consumer requires bootstrap v2.

# ADR-0111: CLI first-publication bootstrap v2 evidence binding

Status: `accepted`; ADR-0112 adds short-lived exact-plan arming
Decision date: 2026-08-21

## Context

Bootstrap v1 separately interpreted one approval containing license/name/scope/publication. ADR-0110 split these into independent sources and one external-evidence report. Reinterpreting human documents in both layers could diverge. With no operational compatibility need in v0, silently accepting v1 would bypass the stronger boundary.

## Decision

- `release:bootstrap:authorize` replaces `--approval` with absolute `--external-evidence`.
- Snapshot package/release manifest/publication authorization/evidence/exact tarball; independently validate evidence schema/digest/target/expiry/fixed limitations/no-effects; match its authorization/artifact/source/package/repository/license to current release.
- Only after local validation call anonymous npm once. On exact public 404 create bootstrap v2, verify all bytes unchanged, and exclusively write a new absolute output.
- Do not reread/interpret license/scope/first-publication source documents. Accept evidence only when it honestly declares unverified receipt issuer, unauthenticated humans, non-registry scope attestation, unknown private absence, and no release-byte verification at evidence stage.
- Bootstrap closes the last limitation by revalidating exact tar/authorization but does not upgrade the other four.
- V2 retains target/identity/release/execution/transition fields and replaces `approval` with digests/times for evidence report, post-apply, receipt, license, scope, and first approval. Include no actors/bodies/paths/credentials/npm bodies/errors.
- Fresh npm observation is valid ten minutes; bootstrap expires at earlier of it and evidence expiry. Retain manual interactive one-time publish, no reuse, and mandatory stage-only transition.
- Reject bootstrap v1 as `first_publication_bootstrap_schema_unsupported` and old `--approval` before source reads. Migration means collecting current evidence and issuing new bootstrap, never automatic conversion.
- Add no credential/approval/reservation/arming/publication/settings/event/state.

## Consequences

External evidence, exact-release freshness, and CLI file/online lifecycle have one owner each; every downstream consumer requires v2.

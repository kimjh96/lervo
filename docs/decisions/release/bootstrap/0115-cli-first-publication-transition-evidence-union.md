# ADR-0115: CLI First-Publication Transition Evidence Union

- Status: accepted
- Decision date: 2026-08-21

## Context

The normal first-publication path produces execution receipt v2 bound to a publisher receipt. Recovery from an unknown outcome instead produces a reconciliation resolution bound to public npm observation and human review. Their provenance and guarantees differ, so a resolution must not be reshaped as an execution receipt. Separate transition policies could diverge, however, and the previous transition lacked a fresh public-package check.

## Decision

Transition publication evidence is an exact-key tagged union:

- `execution_receipt`: one execution receipt v2, revalidated against the original bootstrap, arming authorization, and publication authorization.
- `reconciliation_resolution`: the resolution, reviewed report, decision, reservation v2, and immutable unknown terminal, revalidated by the source-bound resolution validator.

Reject mixed fields and omitted sources. Validation exposes only the original type, exact digest, `publishedAt` or `resolvedAt`, and basis `publisher_receipt_verified` or `public_registry_reconciliation_reviewed`. This normalizes coordinates without merging meanings or claiming recovered 2FA proof.

Use ADR-0113's npm observation rules and exact version, integrity, shasum, and dist-tag requirements as one shared pure policy. Transition reduces the result to `exact_public_release` and blocks absence, partial matches, digest mismatch, and registry unavailability.

Transition report v2 binds the bootstrap digest; normalized evidence type, digest, time, and basis; a later observation time; and checks for the exact public release, stage-only workflow, npm Trusted Publisher, and protected GitHub environment. ADR-0098 retains ownership of stage-only controls. All four checks must be ready.

Receipt v2 records `completed`, bootstrap consumed, `trusted_publisher_stage_only`, workflow `cli-release-matrix.yml`, environment `npm-release`, permission `createStagedPackage`, direct publish forbidden, and the freshly observed public target and digests. Full normalized provenance keeps both paths distinguishable. Readers reconstruct the receipt from evidence and observations. Reject legacy v1 reports and receipts rather than upgrading them.

Errors exclude actors, credentials, reviewers, trust IDs, and raw responses. Use `first_publication_transition_evidence_invalid` for an invalid union and `first_publication_public_release_observation_invalid` for an invalid observation. Add only a provider-neutral pure core and fixtures—no CLI, mutation, activation, runtime event, project state, or telemetry.

> [ADR-0116](0116-cli-first-publication-transition-completion-command.md) connects the core to bounded readers, online observers, and an immutable writer.

## Consequences

Normal and reconciled publication preserve distinct provenance under one completion policy. Neither path may omit a public-release or stage-only control, and reconciliation gains no execution authority.

Fixtures cover both paths, mixed or incomplete unions, source mismatches, stale observations, legacy v1 data, and forged basis values. They claim no network freshness, publication, 2FA, mutation, or workflow activation.

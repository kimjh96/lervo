# ADR-0349: Expose local improvement observations through an explicit CLI host

- Status: `superseded`
- Decision date: 2026-09-03

Superseded by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

Amended by: [ADR-0533](../../../knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The development-pattern pipeline is historical and its commands are removed.

## Context

The production local improvement adapter could collect and verify `verification_success` and `repeated_failure`, but only an embedding test could inject it into the CLI. Installed users could not prepare exact baseline or treatment observations, and apply-time verification required a custom host. Granting every CLI invocation implicit measurement authority would weaken the boundary between ordinary planning and repository-event observation.

## Decision

Package the private local observation adapter in the CLI artifact, but load and activate it only for an individual command carrying `--local-events`.

Add a read-only `knowledge pattern effect collect` action. It accepts one version-1 collection document and returns the exact adapter descriptor, requested phase, pattern, window and metrics, verified observations, and explicit unavailable results. Its report states `attribution: unestablished` and `canonicalMutation: none`.

Allow `--local-events` on the existing register and observe commands. Planning remains available without the flag and does not inspect local evidence. Exact apply continues to require the existing plan ID and `--write`. The local host supplies only the verification port, which reopens canonical event storage and reproduces the reviewed observation before any CAS or event mutation.

Keep adapter construction, collection orchestration, text rendering, CLI parsing, canonical protocol routing, canonical comparison routing, and storage in separate modules. Expose the collector and verifier as distinct host roles even though one adapter implements both.

Do not add a metric, event, database, background observer, automatic promotion, retry, rollback, or model-learning authority.

## Privacy, state, and failure meaning

The collection report is ephemeral output, not canonical or derived repository state. It contains only the existing descriptor, pattern and window coordinates, metric IDs, bounded counts, hashes, unavailability reasons, attribution limit, and mutation disposition. It excludes verification command IDs, raw failures, artifact contents, paths, prompts, provider output, credentials, and user identity.

Without `--local-events`, observation authority is not granted, and collection fails before storage access. Invalid version or collection coordinates are request failures. Empty, unsupported, and over-capacity evidence retain the adapter's explicit unavailable meanings. Invalid or inaccessible canonical evidence retains the existing typed adapter failure.

Collection creates no event or state. Register and observe preserve their all-or-nothing plan/apply failure and re-observation semantics.

## Consequences

An installed local CLI can prepare both observations and complete the reviewed baseline-to-treatment comparison without a custom programmatic host. Local execution needs no Hub, ordinary CLI commands gain no implicit observation authority, and external products may inject another contract-compatible adapter without importing local storage internals.

Because the private adapter enters the published CLI bundle, this change requires reviewed minor release intent and packed-consumer verification.

## References

- Verified improvement effects specification, removed by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)
- [Governed loop and assignment graph](../../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0346](0346-measure-improvement-effects-from-bounded-local-events.md)
- [ADR-0348](0348-measure-exact-repeated-verification-failures.md)

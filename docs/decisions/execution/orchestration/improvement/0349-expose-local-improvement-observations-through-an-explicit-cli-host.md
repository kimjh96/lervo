# ADR-0349: Expose local improvement observations through an explicit CLI host

- Status: `accepted`
- Decision date: 2026-09-03

## Context

The production local improvement adapter could collect and verify `verification_success` and
`repeated_failure`, but only an embedding test could inject it into the CLI. Installed users could
not prepare exact baseline or treatment observations, and apply-time verification still required a
custom host. Giving every CLI invocation implicit measurement authority would weaken the existing
boundary between ordinary planning and repository-event observation.

## Decision

Package the private local observation adapter in the CLI artifact and activate it only for an
individual command carrying `--local-events`. Add a read-only `knowledge pattern effect collect`
action that accepts one version-1 collection document and returns the exact adapter descriptor,
requested phase, pattern, window and metrics, verified observations, and explicit unavailable
results. The report states `attribution: unestablished` and `canonicalMutation: none`.

Allow the same flag on existing register and observe commands. Planning remains possible without
the flag and does not inspect local evidence. Exact apply still requires the existing plan ID and
`--write`; the local host supplies only the verification port, which reopens canonical event
storage and reproduces the reviewed observation before any CAS or event mutation.

Keep adapter construction, collection orchestration, text rendering, CLI parsing, canonical
protocol routing, canonical comparison routing, and storage in separate modules. The host exposes
the collector and verifier as distinct roles even though one adapter implements both. Do not add a
metric, event, database, background observer, automatic promotion, retry, rollback, or model
learning authority.

## Privacy, state, and failure meaning

The collection report is ephemeral output, not canonical or derived repository state. It contains
only the existing descriptor, pattern and window coordinates, metric IDs, bounded counts, hashes,
unavailability reasons, attribution limit, and mutation disposition. It excludes verification
command IDs, raw failures, artifact contents, paths, prompts, provider output, credentials, and user
identity.

Missing `--local-events` means observation authority was not granted and collection fails before
storage access. Invalid version or collection coordinates are request failures. Empty, unsupported,
and over-capacity evidence retain the adapter's existing explicit unavailable meanings. Invalid or
inaccessible canonical evidence retains the existing typed adapter failure. Collection creates no
event or state. Register and observe preserve their existing all-or-nothing plan/apply failure and
re-observation semantics.

## Consequences

An installed local CLI can now prepare both observations and complete the reviewed
baseline-to-treatment comparison without a custom programmatic host. Local execution still needs no
Hub, ordinary CLI commands gain no implicit observation authority, and external products may inject
another contract-compatible adapter without importing local storage internals.

Because the private adapter now enters the published CLI bundle, this change requires reviewed
minor release intent and packed-consumer verification.

## References

- [Verified improvement effects](../../../../specifications/execution/verified-improvement-effects.md)
- [Governed loop and assignment graph](../../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0346](../0346-measure-improvement-effects-from-bounded-local-events.md)
- [ADR-0348](0348-measure-exact-repeated-verification-failures.md)

# ADR-0356: Reuse exact terminal knowledge lifecycle inspections

- Status: accepted
- Decision date: 2026-09-03

## Context

Source-current dogfood on the Lervo repository found useful document selection and prompt-hook
latency below the accepted 15-second budget, but direct `Stop` observations exceeded the 5-second
p95 budget. The `lifecycle_inspection` stage took between 13 and 21 seconds in recent observations.
It repeatedly scanned the same repository for instruction bootstrap, layout, structural migration,
provider bridge, normalization, and lint, even though those read-only checks shared one immutable
source boundary.

Increasing the budget or skipping lifecycle checks would hide the problem. A process-global cache
would also be unsafe because repository bytes, local verification and execution evidence, CLI
behavior, or an interrupted materialization transaction can change independently.

## Decision

One bounded terminal lifecycle inspection prepares one repository-knowledge scan and may reuse it
only inside that read-only inspection. Every consumer still validates the prepared scan's project
and policy coordinates. Structural planning remains ordered—bootstrap, layout, materialization,
then provider bridge—while the independent normalization-and-lint branch may run concurrently.
Lint reuses the exact normalization observation instead of repeating it.

The CLI may persist the completed knowledge-only result as the rebuildable state projection
`terminal_knowledge_lifecycle_cache_v1` at
`.lervo/state/terminal-integration/knowledge-lifecycle-cache.json`. The cache contains only:

- schema version and installed CLI version;
- exact repository snapshot revision;
- one digest over the ordered supplemental-source coordinates and content hashes; and
- at most 128 bounded lifecycle issue codes, commands, and safe typed details.

It contains no prompt, projected query, source body, document path inventory, provider output,
credential, absolute path, or user identity. An exact CLI version, repository revision, and
supplemental-source digest match is required. An active or invalid materialization transaction is
checked before cache reuse. Invalid, unreadable, mismatched, or missing cache state is a miss and
causes a complete inspection. Technical inspection failures are not cached. Cache-write failure
does not change the freshly computed lifecycle result. A second repository snapshot must still
match before publication, preventing a mixed concurrent scan from receiving the earlier revision's
key. Deleting all `.lervo/state` remains a supported recovery operation.

No event is added and no evidence level changes. A cache hit proves only reuse of an exact prior
Lervo-owned lifecycle projection. Direct terminal work remains unmanaged; completion and document
reference semantics remain unchanged. The current environment profile still records cache state as
`unknown`, so operational timing populations do not claim a measured warm/cold classification.

## Consequences

Repository-knowledge scanning has one responsibility boundary per lifecycle observation, and the
terminal entrypoint no longer coordinates each compiler subsystem directly. Repeated exact-state
Stop checks avoid redundant compilation while source, evidence, policy, CLI version, and recovery
changes invalidate naturally.

A first inspection after an invalidating change may still exceed the steady-state Stop target.
The existing population gate remains authoritative: no single warm observation proves p95
compliance, and old exhausted observations are not discarded or reclassified.

## Verification

- Unit tests bind exact repository and supplemental-source cache coordinates and prove source bodies
  are not stored.
- Terminal integration tests retain root availability, worker fail-closed isolation, stale
  lifecycle findings, failure meaning, and stage evidence.
- Source-current dogfood records both the first post-invalidation and repeated exact-state Stop
  observations, prompt timing, selected current publications, and query-projection usage.
- Quality, documentation, knowledge lifecycle, packed-CLI, distribution, and release-completion
  checks must pass.

## References

- [Execution stage observation and performance](../../../specifications/execution/stage-observation-and-performance.md)
- [Availability-safe unmanaged terminal hooks](../../execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Scope-complete resource and terminal budgets](0354-enforce-scope-complete-resource-and-terminal-budgets.md)
- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)

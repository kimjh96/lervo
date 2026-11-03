# Retained execution event and reporting contracts

This supplement retains the contracts described by the linked source documents. It records no new test execution, installed acceptance, deployment or publication.

## Repository upgrade role bindings

Source: [Repository upgrade role bindings](../workforce-events/repository-upgrade-role-bindings.md).

Repository upgrade refreshes a stale shipped built-in agent with `agent.identity.changed` and `changeKind=role_binding`. Refreshing a repository-defined role binding requires the current plan's exact per-role operation ID and approval hash.

Each stale assignment refresh emits `assignment.role.binding.changed`, requiring `assignmentId`, previous and next role version, role contract hash, required capability hash, `roleId`, and `revision`.

A required capability hash changes only when it exactly matches one stale agent binding with one unambiguous replacement. Repository-role approval changes generated binding records only; it never rewrites `.lervo/roles`.

The event excludes task text, role prose, source paths, capability bodies, provider configuration, and credentials.

Event rejection restores the individual state file. Interruption may leave earlier records refreshed; the next content-bound plan resumes only the remaining records. No wrapper event claims whole-stage completion.

## Managed context evidence

Source: [Managed context evidence](managed-context-evidence.md).

`context.selected` accepts `origin: managed_turn` for managed preparation and measurement, `hook` for hook selections, and `agent_query` for an explicitly bound terminal query. Historical selections may omit origin. Agent-query coordinates, privacy, and failure meaning follow the [terminal observation contract](../terminal-observations/context-reference-and-turn-evidence.md). Selection alone establishes no load, injection, or internal use.

Managed `context.injected` events include adapter and provider session and, for every document, E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version.

Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run.

Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.

## Managed resource reporting

Source: [Managed resource reporting](managed-resource-reporting.md).

Managed resource descriptors contain provider and adapter identity, accounting mode, normalization and native-counter semantic IDs, support state, and nullable model and service tier. Their schemas exclude credentials and unrestricted native metadata.

The shared work report groups observations by provider, scope, source, mode, and descriptor hash; it does not combine cross-provider totals or infer price.

## Terminal coverage

Source: [Terminal coverage](terminal-coverage.md).

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Each observed turn reports `selectedCount`, `referenceCount`, and `pathMentionCount` from its closing event. Missing later counts remain null for historical events. The report validates reference and path-mention counts against their event IDs. Compact pointers and query selections can produce path references with zero loaded documents. These references establish output-reference availability but do not change loaded-document delivery ratios. The CLI labels path mentions as a proxy and states that they prove neither reading nor reliance.

Terminal coverage keeps resource meanings separate:

- Whole-task provider usage is always `unavailable` with `unmanaged_provider_usage_unobserved` because direct provider execution is outside the managed adapter boundary.
- Usage directly retained by the query-projection receipt is reported separately as `partial` with `accounting_descriptor_unavailable`; a missing receipt counter is `query_projection_usage_unavailable`.

Neither value is billed cost.

## Workstream snapshots

Source: [Workstream snapshots](workstream-snapshots.md).

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths.

The local projection is written lazily under `.lervo/state/workstreams/` and follows the checked-out branch through the local `bindings.json` selection ([ADR-0526](../../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md)); exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.

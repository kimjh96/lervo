# Execution events and privacy

Status: `active`
As of: 2026-08-25

This document defines event-specific evidence and privacy guarantees linked from the [execution specification](../execution.md). Events use schema allowlists and a validated hash chain. Every event and state defines its name and version, identifiers and hashes, privacy, success, and failure or retry meaning. Payloads exclude raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted errors.

## Workforce events

Workforce events record only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose and source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration. State and event commit together, with byte restoration on event failure. Invalid or stale role contracts, contention, expiry, and rejected claims record no execution success.

Agent state may contain exact capability package IDs, kinds, versions, content hashes, and project/user source scopes. `capabilityHash` binds these coordinates with role permission decisions. It excludes package bodies, publisher metadata, local paths, MCP configuration values, credentials, and Hub tokens. Registration failure records neither a hired agent nor package authority. Capability installation and Hub publication return operation receipts, add no execution event, and prove no loading, activation, invocation, or use.

Managed `capability.activated` is emitted only after the provider adapter returns a valid exact receipt. Its envelope binds project, run, session, provider actor, and confirmation time. Its payload contains capability ID and kind, version and content hash, adapter and provider-session IDs, evidence (`mcp_connected` or `plugin_loaded`), and a privacy-bounded activation digest. It excludes local paths, commands, arguments, URLs, configuration, credentials and their names, plugin content, tool inventories, and raw errors. Confirmation failure or timeout emits no activation event, blocks the task turn with `capability_activation_failed`, and is represented only by the bounded `run.failed` diagnostic digest. Activation proves connection or load before the turn, not invocation or use.

`capability.recommended` retains capability coordinates, numeric score, bounded reason codes, and a query digest; it excludes the natural-language request and package prose. `capability.selected` retains the selection reason. `capability.loaded` retains source scope and a validation digest but excludes local paths and package bytes. `skill.invoked` binds skill ID, version, request digest, and declared capability names; `skill.completed` binds status and result artifact coordinates. Absence of completion means failure or unobserved completion, never success. None of these events proves attention, understanding, correctness, or semantic reliance.

`capability.invoked` and `capability.completed` are emitted only for a normalized MCP tool name exactly matching a confirmed activation's server name. They retain package coordinates, a provider-item digest, input digest or terminal status, and duration; they exclude tool names, arguments, output, server configuration, and credentials. A provider plugin has no invocation event without adapter-supplied exact binding.

## Knowledge and terminal integration

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time.

`terminal.integration.applied` records contract, providers, provider-target path digests and after-hashes, generated-runtime path digest and after-hash, approval hash, and time. It excludes prompts, bodies, raw configuration, commands, runtime bytes, credentials, absolute paths, and output. Failure rolls back and emits no success event.

Bounded provider and event activation receipts contain provider, event, result, time, and bounded hashes and counts. They prove only that the Lervo hook endpoint executed or prepared context, not that the provider launched, accepted, understood, referenced, or used it. Status labels this evidence `hook_endpoint_observed_not_provider_authorship`. Receipt failure blocks the hook. Status validates receipts against events, distinguishes endpoint observation from readiness, and emits a provider-specific action until every required event is observed. Lervo never changes local or global hook trust.

## Terminal observations

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain opaque IDs, domain-separated digests, repository-relative coordinates, hashes, counts, assurance, freshness, lifecycle state, reference availability, prepared and final repository revisions, the derived changed flag, and final verified workstream ID, revision, and snapshot hash. `terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition and optional completed-deliberation ID, and time. These events exclude prompts, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations do not prove internal reasoning.

Preparation commits before context; declaration commits after repository work; reference and turn commit together before Stop. Missing context during mid-turn hook activation emits no event or receipt, requests one bounded continuation, then permits an already-continued turn without evidence. Malformed input, stale declaration, or persistence failure fails closed.

Terminal observation evolution is additive and history-preserving. The original base remains accepted; later repository and workstream coordinate groups are all-or-none. Current producers emit the complete latest group, while consumers treat absent later groups as unobserved. A partial group is invalid, but validation failure never permits deletion, rewriting, or omission of immutable event history.

## Workstreams and coverage

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths. The local projection is written lazily under `.lervo/state/workstreams/`; exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Managed `context.injected` events include adapter and provider session and, for each document, E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version. Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run. Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.

## References

- [Execution specification](../execution.md)
- [Additive terminal observation compatibility](../../decisions/execution/providers/0208-additive-terminal-observation-schema-compatibility.md)
- [Conflict-safe repository agent workforce](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)

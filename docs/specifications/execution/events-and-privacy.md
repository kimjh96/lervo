# Execution events and privacy

Status: `active`
As of: 2026-09-01

This document defines event evidence and privacy guarantees linked from the [execution specification](../execution.md). Events use schema allowlists and a validated hash chain. Every event and state defines its name and version, identifiers and hashes, privacy, success, and failure or retry meaning. Payloads exclude raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted errors.

## Event envelope compatibility

The shared reader accepts envelope schema versions 1 and 2 and preserves valid mixed
hash chains without rewriting their bytes or meaning. Version 1 remains the default
writer; activated managed execution writes version 2. A supported but malformed envelope is `event_invalid` at
the event-contract boundary and an integrity failure where stored bytes are decoded. An
unknown integer envelope version is `event_schema_unsupported`; local storage, sync,
and Hub intake reject it before mutation. Invalid hashes and payload allowlists remain
integrity failures rather than unsupported-version failures.

Envelope version 2 makes the following payload contracts readable. FH1 now emits only
the causal contract; resource and stage contracts remain reader-only:

- `work.causality.recorded` retains opaque work, run-relationship, attempt, workstream,
  assignment, and agent coordinates. Root, retry, and other child shapes are
  discriminated in the payload schema. One event per run, one root per work, existing
  same-work parents, exact retry ordinals, acyclic ancestry, and idempotent recovery are
  enforced before provider startup. Deliberation uses one control root with role and
  publication-evaluation children.
- `resource.usage.recorded` retains an opaque observation and source digest, scope,
  source, accounting mode and descriptor hash, status, bounded counters, and reason
  code. Counts are non-negative; cached input cannot exceed input, reasoning output
  cannot exceed output, and total equals input plus output. `unavailable` and `invalid`
  contain no fabricated usage. Provider identity and native counter semantics remain in
  a future local descriptor, not this event.
- `execution.stages.observed` retains managed or unmanaged mode, an opaque work or
  terminal coordinate, observation and environment digests, repository profile, and at
  most 32 catalogued stage results. It excludes paths, prompts, queries, outputs,
  credentials, and vendor span names.

All three payloads use exact top-level allowlists. Resource counter names are the only
approved token-like nested keys. Schema, discriminator, arithmetic, or privacy failure
prevents sync acceptance and creates no observation success. Missing resource or stage
events mean `unobserved`, not zero usage or successful stage measurement. A requested
historical run without a causal event is `legacy_unlinked`; missing ancestry is never
reconstructed from correlation.

## Workforce events

Workforce events contain only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose and source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration. State and event commit together, restoring bytes on event failure. Invalid or stale role contracts, contention, expiry, and rejected claims record no execution success.

Agent state may contain exact capability package IDs, kinds, versions, content hashes, and project or user source scopes. `capabilityHash` binds these coordinates and role-permission decisions. It excludes package bodies, publisher metadata, local paths, MCP configuration values, credentials, and Hub tokens. Registration failure records neither a hired agent nor package authority. Capability installation and Hub publication return operation receipts, add no execution event, and prove no loading, activation, invocation, or use.

Managed `capability.activated` is emitted only after the provider adapter returns a valid exact receipt. Its envelope binds project, run, session, provider actor, and confirmation time. Its payload contains capability ID and kind, version and content hash, adapter and provider-session IDs, evidence (`mcp_connected` or `plugin_loaded`), and a privacy-bounded activation digest. It excludes local paths, commands, arguments, URLs, configuration, credentials and credential names, plugin content, tool inventories, and raw errors. Confirmation failure or timeout emits no activation event, blocks the task turn with `capability_activation_failed`, and appears only as the bounded `run.failed` diagnostic digest. Activation proves connection or load before the turn, not invocation or use.

## Agent workspace events

The isolated-workspace design adds canonical coordination events to the shared repository-instance home.

`agent.workspace.provisioned` retains workspace, assignment, agent, repository-instance, adapter, generation, base and integration-target digests, and time. It proves only that adapter, marker, Git identity, base, and cleanliness agreed after provisioning.

`agent.workspace.state.changed` retains workspace, assignment, generation, previous and next state, bounded reason code, optional lease generation, and time. Valid states are `provisioning`, `ready`, `active`, `sealing`, `sealed`, `integration_pending`, `integrating`, `integrated`, `integration_conflict`, `cleanup_eligible`, `removing`, `removed`, and `recovery_required`. Process exit, lease expiry, and missing bytes emit no inferred transition.

`agent.workspace.sealed` retains workspace, assignment and generation, base/head/tree hashes, changed-path-set digest and count, result artifact and verification coordinates, no-change flag, and time. It proves an immutable integration candidate, not acceptance or incorporation.

`assignment.integration.state.changed` version 1 retains integration attempt and target-lease IDs; repository-instance and target digests; target generation and target-before hash; integration assignment, integrator agent and workspace IDs; ordered source workspace IDs, generations, and head hashes; previous and next attempt state; optional candidate head and tree hashes or conflicting workspace ID and bounded `git_conflict` reason; revision and time. States are `leased`, `candidate`, and `conflict`. The event excludes target refs, branch and path names, changed-path digests, commit messages, commands, conflict text, source bytes, verification claims, prompts, outputs, and credentials. `leased` proves only exclusive local ownership of that exact target generation. `candidate` proves a clean isolated-worktree candidate while the target ref remains unchanged. `conflict` proves the Git operation was aborted and the isolated worktree returned to target-before; it is not integration success. A stale target emits no lease event. Uncertain abort or state/event persistence emits no candidate or conflict success.

`assignment.integration.recorded` retains integration and integration-assignment IDs, integrator workspace, ordered source workspace generations and head hashes, target-before and target-after hashes, strategy, verification coordinates, and time. It is emitted only when exact incorporation and required verification commit together. Conflict, stale target, and verification failure emit no integration success.

`agent.workspace.removed` retains workspace and generation, integration or discard evidence ID, cleanup plan ID, adapter kind and version, and time. It proves the registered checkout and Git worktree metadata were absent after non-force removal. It does not prove branch deletion, artifact erasure, assignment retirement, or remote cleanup.

Hub audit transitions `workspace.reservation.granted`, `workspace.reservation.renewed`, `workspace.reservation.released`, and `workspace.reservation.expired` retain project and repository identity, opaque reservation, assignment, workspace and Node IDs, scope and target digests, generation, expiry, idempotency digest, transition, and time. They are not local execution events and grant no repository authority.

`workspace.summary.recorded` is a Hub-only append-only audit transition. It requires project and repository identity hashes, opaque workspace, assignment and Node IDs, generation, previous and next lifecycle states, host kind, bounded process observation and terminal count, optional integration and cleanup-plan IDs, content hash, and acceptance time. It excludes paths and host-native instance coordinates. The first summary must be `provisioning`; generation and state transitions are monotonic. Duplicate content is idempotent. Unknown-parent, stale, capacity, or authentication failure records no new summary audit row and changes no local state.

All workspace payloads exclude absolute and repository-relative paths, branch names, task and acceptance prose, source and patch bodies, commands, prompts, provider output, terminal content, credentials, approvals, reasoning, and unrestricted errors. Event failure rolls back the state transition when the host effect is reversible. Uncertain provisioning or removal enters `recovery_required` and emits no success event.

`capability.recommended` retains capability coordinates, numeric score, bounded reason codes, and a query digest; it excludes the natural-language request and package prose. `capability.selected` retains the selection reason. `capability.loaded` retains source scope and a validation digest but excludes local paths and package bytes. `skill.invoked` binds skill ID, version, request digest, and declared capability names. `skill.completed` binds status and result-artifact coordinates. Missing completion means failure or unobserved completion, never success. None proves attention, understanding, correctness, or semantic reliance.

`capability.invoked` and `capability.completed` are emitted only for a normalized MCP tool name exactly matching the server name in a confirmed activation. They retain package coordinates, a provider-item digest, input digest or terminal status, and duration. They exclude tool names, arguments, output, server configuration, and credentials. A provider plugin has no invocation event without adapter-supplied exact binding.

## Knowledge and terminal integration

`context.recommended` may include `productQualificationId` when the shipped product default selected the search engine. The value is an opaque `spqual_` content coordinate and is mutually exclusive with a repository-local `selectionTransitionId` on its source search attempt. It contains no query, corpus, path, source body, provider output, or credential. Presence proves only product-default selection of the bound engine build; absence on historical events means the qualification was unobserved. Invalid, missing, or mismatched qualification prevents the non-baseline attempt and recommendation from being recorded.

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time. Canonical provider-entrypoint adoption uses `operation=instruction_canonical_adoption`; its event binds the exact approval digest and creation count but excludes CLAUDE and AGENTS paths and bodies. The local receipt may expose source and canonical content hashes. Failure before event commit restores AGENTS. An interrupted journal requires ordinary explicit recovery and emits no success event.

`state.pruned` records the exact prune-plan ID, policy and inventory hashes, removed-file and byte totals, bounded per-class counts, and application time. It excludes artifact paths and path digests, content hashes and bodies, source text, credentials, and recovery-journal details. It means eligible derived bytes were detached and durable evidence committed. Event failure restores detached targets and emits no success. A crash before or after event commit leaves a recovery tombstone; explicit recovery restores bytes if the event is absent or completes cleanup if it is present.

`development.pattern.observed` records pattern and observation IDs, provider, source-snapshot and evidence digests, independent occurrence count, and time. `development.pattern.transitioned` records transition and pattern IDs, prior and next lifecycle states, candidate and review artifact coordinates, target kind, exact approval digest, and time. They exclude candidate and review bodies, occurrence and target paths, verification commands, reviewer identity, source text, credentials, and model output. Observation proves only evidence submission, not that a convention is true or approved. Transition success means the immutable artifact or exact promotion transaction committed. Storage or event failure records no transition, and promotion restores changed bytes.

`terminal.integration.applied` records contract, providers, provider-target path digests and after-hashes, generated-runtime path digest and after-hash, approval hash, and time. It excludes prompts, bodies, raw configuration, commands, runtime bytes, credentials, absolute paths, and output. Failure rolls back and emits no success event.

Bounded provider and event activation receipts contain provider, event, result, time, and bounded hashes and counts. They prove only that the Lervo hook endpoint executed or prepared context, not that the provider launched, accepted, understood, referenced, or used it. Status labels this evidence `hook_endpoint_observed_not_provider_authorship`. Receipt failure blocks the hook. Status validates receipts against events, distinguishes endpoint observation from readiness, and emits a provider-specific action until every required event is observed. Lervo never changes local or global hook trust.

## Terminal observations

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain opaque IDs, domain-separated request and retrieval digests, typed grounding status, workflow/source/subject/provider identifiers and bounded reason codes, candidate counts, repository-relative coordinates, hashes, assurance, freshness, lifecycle state, reference availability, prepared and final repository revisions, the derived changed flag, and final verified workstream ID, revision, and snapshot hash. Direct unmanaged prompt preparation uses grounding reason `unmanaged_terminal_retrieval_only` with empty semantic-action coordinates. The preparation event distinguishes candidate selection, hash-bound loading, hook preparation, provider injection (`unobserved`), and provider use (`unknown`). It never upgrades hook-side preparation into delivery or use. For a direct root session, `lifecycleStatus: action_required` may coexist with `completionResult: allowed`: the former is an observed repository finding, while the latter means the audit did not claim authority to block provider availability. Attached-worker isolation may still record `blocked`. Empty hook success after an internal failure creates neither event nor inferred success. `terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition, optional completed-deliberation ID, and time. These events exclude prompts, retrieval-query text, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations do not prove internal reasoning.

Preparation commits before context; declaration commits after repository work; reference and turn commit together before Stop. Missing context during mid-turn hook activation emits no event or receipt and requests one bounded continuation. Any valid re-entered Stop marked `stop_hook_active` returns empty success before repository or persistence work and creates no observation or receipt, including when preparation exists. Malformed input, stale declaration, and persistence failure fail closed.

Terminal observation evolution is additive and history-preserving. The original base remains accepted; later repository and workstream coordinate groups are all-or-none. Current producers emit the complete latest group, while consumers treat absent later groups as unobserved. A partial group is invalid, but validation failure never permits deletion, rewriting, or omission of immutable event history.

`deliberation.artifact.publication_failed` retains deliberation, role, producer provider, semantic-evaluator provider, round, attempt, artifact ID and content hash, repository-verification status, writing-publication failure, recovery state, bounded failed or missing check IDs, semantic-evaluation status, and repair limit. It excludes provider output, prompts, transcripts, source bodies, paths, unrestricted errors, and credentials. The event means the provider result remains quarantined in CAS and is recoverable with `lervo deliberate artifact --content-hash`; it is not a published deliberation artifact. Repository verification and writing publication remain independent facts.

## Workstreams and coverage

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths. The local projection is written lazily under `.lervo/state/workstreams/`; exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Managed `context.injected` events include adapter and provider session and, for every document, E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version. Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run. Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.

## References

- [Execution specification](../execution.md)
- [Additive terminal observation compatibility](../../decisions/execution/providers/0208-additive-terminal-observation-schema-compatibility.md)
- [Conflict-safe repository agent workforce](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Isolated agent workspace lifecycle](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)

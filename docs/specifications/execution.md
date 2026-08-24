# Lervo Execution and Evidence Specification

Status: `active`
As of: 2026-08-24

## 1. Scope

Defines provider-neutral contracts for managed runs, evidence, documents, knowledge, telemetry, and recovery. ADRs retain rationale.

## 2. Managed run lifecycle

```text
requested -> resolved -> context prepared -> provider started
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among contracts, capability decisions, context evidence, provider results, repository snapshots, and verification. Other provider work is `unmanaged`.

Direct Codex and Claude hooks may query, exact-hash load, and prepare at most 28 KiB of valid UTF-8 context before committing preparation and returning from `UserPromptSubmit`. This creates no managed run and proves no acceptance, understanding, or use. Fail-closed `Stop` always requires current migration, bridge, knowledge, lint, and normalization. It compares the prepared repository revision with current repository-authored bytes. Unchanged turns create no artificial workstream history. Changed turns require the working agent—not the user—to create or advance the workstream with an agent/provider coordinate and emit an exact-revision bounded turn declaration after all changes. Stop records only bounded coordinates and exact output-reference tokens matching the prepared session and turn. New tokens are standalone Markdown HTML comments; legacy plain v1 tokens remain accepted for in-flight sessions.

A present current workstream must match its latest `workstream.snapshot.recorded` event and CAS artifact. Managed runs select it through required rule `repository.workstream` and load exact bytes before E3. Direct hooks prepend at most 8 KiB and record only ID, revision, snapshot hash, delivered bytes, and full or prefix scope. Absence is valid for an unchanged turn before the first checkpoint; invalid state fails immediately. After repository bytes change, direct completion fails until a verified first revision exists or the present revision advances beyond the prompt-time revision. Bounded pending decisions and approvals are unresolved current state; resolved history belongs in canonical documents.

Managed search records operational and repository-knowledge recommendations separately. If an AGENTS instruction or registered document appears in both, injection discovery must resolve one canonical document ID with identical metadata; unproven same-path identity fails before the turn.

## 3. Context evidence

| Level | Meaning |
|---|---|
| E0 | Candidate discovered. |
| E1 | Candidate selected by policy. |
| E2 | Current bytes loaded and validated. |
| E3 | Adapter acknowledged the exact delivered envelope. |
| E4 | Validated provider result explicitly cited the exact injected version. |

E3 proves controlled injection, not understanding or use. E4 requires a structured result matching E3 on run, session, provider session, target and provider turns, adapter receipt, context generation, document ID, content hash, and scope. The exact `lervo-e4:<documentId>:<contentHash>` token must be a standalone Markdown HTML comment. It proves only bounded output citation—not attention, semantic reliance, understanding, agreement, correctness, or internal use. Internal use is unsupported.

`@lervo/context-coverage` rebuilds one report from canonical events, retaining all E1 reasons, E2 versions and revisions, enhanced E3 coordinates, valid E4, highest evidence, and missing stages. Delivery, reference, relevance, and selection ratios remain separate. Unknown denominators are `null` with a reason; no combined score exists.

Unmanaged observations use `prepared -> referenced`, never E1–E4. Preparation proves hook-side construction; reference proves only a matching marker in bounded Stop output. Lervo neither rewrites nor stores that output.

## 4. Capability decisions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

Write approval binds project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation. Revalidate immediately before mutation.

## 5. Provider adapters

Codex and Claude share contract tests and normalize native session, tool, usage, error, and result events without inventing telemetry. Provider-specific behavior stays behind profile boundaries.

Terminal profiles merge approved handlers into project arrays while preserving settings and hooks. Invalid JSON or shapes, conflicting Lervo commands, Claude disablement, or Codex project-hook disablement blocks migration. Authority excludes local, global, and organization settings. Successful apply is installation evidence, not activation readiness: human and JSON output must immediately disclose Codex's one-time `/hooks` review. `terminal status` remains `action_required` until canonical invocations for both events are observed, while distinguishing an unreviewed-or-unobserved Codex hook from a stale repository lifecycle.

Managed runs use a role-bound English machine-result protocol. A separate read-only session of the selected local provider evaluates human-facing publication in an empty temporary repository without documents, tools, or write access. Its exact JSON is content-bound evidence, not independent cross-provider or human review, proof of understanding, or writing-policy E3. Failure blocks publication and CLI success but not an already verified file change.

The validated result is the E4 source. Before publication, remove only exact evidence tokens for current E3 versions and store the human artifact under a separate digest. Writing checks, permits, `run.completed`, and display bind to that projection. `adapter.result.captured` retains the unprojected digest without content. Unknown tokens remain visible; empty projection fails closed.

## 6. Repository snapshots and writes

Plans bind state, expected paths, before and desired hashes, and verification. Apply rejects symlinks, escape, changed targets, unapproved paths, and stale plans.

Snapshots cover repository-authored files, excluding runtime state, dependencies, and conventional generated build or cache directories. Source and tracked generated files remain covered.

User content changes only through explicit content-bound operations. Managed blocks preserve outside bytes. Generated files may change or be deleted only when recorded generation proves current-hash ownership.

## 7. Verification

Suites declare exact commands, working directories, limits, and outcomes. Lervo compares pre- and post-snapshots and rejects unexpected changes. Bounded command output is artifact data, not event content.

## 8. Repository knowledge

Tracked scanner, publication, language, taxonomy, routing, and leaf bounds govern knowledge. Documentation stays under `docs/`; `.lervo` stores policy, provenance, manifests, and rebuildable state. V1 publishes English with deterministic sharding.

Structural planning is read-only. Generated changes and user bytes require current bindings and exact approval where specified. Unknown or tied classifications, unsafe sources, provider-specific enforcement, and over-capacity layouts fail closed. Isolated no-capability semantic compilation and normalization retain complete source-unit coverage; provider output and successful materialization are not semantic truth.

The [repository knowledge compilation specification](../specs/repository-knowledge-compilation.md) defines candidates, approvals, durable apply, lifecycle, skill resources, entrypoints, splits, bridges, agent surfaces, and recovery rules.

## 9. Entrypoints and language

README is concise human onboarding; AGENTS is concise provider-neutral guidance; CLAUDE is a thin AGENTS bridge. Generated publications use a versioned catalog and tracked language. Normalization uses that language and a versioned profile; v1 supports English. Neutral localized titles preserve exact encoded paths. Human writing binds `publication.language` to `writing_en-human`, semantic checks, policy hash, evaluation, and permit. Deliberation carries locale through profiles, prompts, verdicts, evaluation, and publication. Unsupported locales fail before execution; provider prose never implies approval. Initialization creates minimum configuration; feature and state directories remain lazy.

## 10. Events and privacy

Events use schema allowlists and a validated hash chain. Payloads exclude raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted errors. Every event and state defines name and version, identifiers and hashes, privacy, success, and failure or retry meaning.

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time.

`terminal.integration.applied` records contract, providers, path digests, after-hashes, approval hash, and time; it excludes prompts, bodies, raw configuration, commands, credentials, absolute paths, and output. Failure rolls back and emits no success event.

Bounded provider and event activation receipts contain provider, event, result, time, and bounded hashes and counts. They prove that the Lervo hook endpoint executed or prepared context, not that the provider launched, accepted, understood, referenced, or used it. Status labels the evidence `hook_endpoint_observed_not_provider_authorship`. Receipt failure blocks the hook. Status validates receipts against events, separates endpoint observation from readiness, and emits a provider-specific action until every required event is observed. Lervo never changes local or global hook trust.

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain opaque IDs, domain-separated digests, repository-relative coordinates, hashes, counts, assurance, freshness, lifecycle state, reference availability, prepared and final repository revisions, the derived changed flag, and final verified workstream ID, revision, and snapshot hash. `terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition and optional completed-deliberation ID, and time. These events exclude prompts, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations are not proof of internal reasoning. Preparation commits before context; declaration commits after repository work; reference and turn commit together before Stop. Missing context, stale declaration, or persistence failure fails closed.

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths. The local projection is written lazily under `.lervo/state/workstreams/`; exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Managed `context.injected` events include adapter and provider session and per-document E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version. Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run. Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.

## 11. Durable apply and recovery

The owner-only journal validates plan and current bytes, stages outputs, backs up originals, publishes or deletes, lints, commits the event, then cleans backups and empty parents. Pre-commit failure restores originals. Post-commit cleanup failure preserves outputs and requires recovery. Interrupted transactions block mutation. Rollback recreates only parents pruned by that transaction before restoring exact backups, including deleted shards and moved documents.

## 12. Hub and remote execution

Hub and Node coordination remains authenticated, project-scoped, local-policy-bound, and independent of a specific network. Event streams, repository-scoped workstream replication, remote authority, runtime health, and service stability are defined in the [Hub and Node coordination specification](coordination/hub-and-node.md).

## 13. Failure categories

| Category | Required behavior |
|---|---|
| Invalid contract or policy | Fail before provider or write execution. |
| Stale plan or snapshot | Produce a new read-only plan. |
| Approval missing or revoked | Deny capability. |
| Incomplete telemetry | Lower assurance; infer neither success nor use. |
| Verification failure | Do not emit successful completion. |
| Event commit failure | Roll back pre-commit bytes. |
| Post-commit cleanup failure | Preserve bytes and require recovery. |
| Uncertain remote effect | Record uncertainty; do not retry automatically. |
| Secret or unsafe source | Exclude content; retain bounded diagnostics only. |

## 14. Required verification

Schema and redaction tests; shared adapter contracts; write and recovery failure injection; transient service compensation and readiness; synchronization empty-outbox, long-chain, gap, and cursor-conflict tests; knowledge plan, apply, lint, and idempotence; source privacy, path, symlink, size, and race tests; and applicable boundary, type, documentation, build, and distribution checks.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Hub and Node coordination](coordination/hub-and-node.md)

# Lervo Execution and Evidence Specification

Status: `active`
As of: 2026-08-26

## 1. Scope

Defines provider-neutral contracts for managed runs, evidence, documents, knowledge, telemetry, and recovery. ADRs retain rationale.

## 2. Managed run lifecycle

```text
requested -> resolved -> documents/capabilities recommended and selected
-> bytes loaded -> context prepared -> provider started
-> context injected -> capabilities activated / skills invoked -> provider turn
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among contracts, capability decisions, context evidence, provider results, repository snapshots, and verification. Other provider work is `unmanaged`.

Direct Codex and Claude hooks use a repository-local, self-verifying contract-v2 runtime. Before preparation is committed and `UserPromptSubmit` returns, they may query, exact-hash load, and prepare at most 28 KiB of UTF-8 context. This creates no managed run and proves no acceptance, understanding, or use. Fail-closed `Stop` requires current migration, bridge, knowledge, lint, and normalization, and compares prepared and current repository-authored revisions. Unchanged turns create no artificial workstream history. After a changed turn, the working agent—not the user—must create or advance the workstream with an agent/provider coordinate and emit an exact-revision turn declaration. Stop records only bounded coordinates and exact output-reference tokens matching the prepared session and turn. If activated after the turn began, Stop requests one JSON continuation; if the turn already continued without context, Stop succeeds without evidence and remains unmanaged. New tokens are standalone Markdown HTML comments; legacy plain v1 tokens remain valid for in-flight sessions.

A current workstream must match its latest `workstream.snapshot.recorded` event and CAS artifact. Managed runs select it through required rule `repository.workstream` and load exact bytes before E3. Direct hooks prepend at most 8 KiB and record only ID, revision, snapshot hash, delivered bytes, and full or prefix scope. Absence is valid only for an unchanged turn before the first checkpoint; invalid state fails immediately. After repository bytes change, direct completion fails until a verified first revision exists or the current revision exceeds the prompt-time revision. Bounded pending decisions and approvals are unresolved current state; resolved history belongs in canonical documents.

Managed search records operational and repository-knowledge recommendations separately. If an AGENTS instruction or registered document appears in both, injection discovery must resolve one canonical document ID with identical metadata; unproven same-path identity fails before the turn.

Managed sessions suppress native project hooks. Graph-selected registered documents use bounded post-search projections and ordinary E1–E3 evidence (ADR-0216, ADR-0217).

## 3. Context evidence

| Level | Meaning |
| --- | --- |
| E0 | Candidate discovered. |
| E1 | Candidate selected by policy. |
| E2 | Current bytes loaded and validated. |
| E3 | Adapter acknowledged the exact delivered envelope. |
| E4 | Validated provider result explicitly cited the exact injected version. |

E3 proves controlled injection, not understanding or use. E4 requires a structured result matching E3 on run, session, provider session, target and provider turns, adapter receipt, context generation, document ID, content hash, and scope. The exact `lervo-e4:<documentId>:<contentHash>` token must be a standalone Markdown HTML comment. It proves only bounded output citation—not attention, semantic reliance, understanding, agreement, correctness, or internal use. Internal use is unsupported.

`@lervo/context-coverage` rebuilds one report from canonical events, retaining every E1 reason, E2 version and revision, enhanced E3 coordinate, valid E4, highest evidence, and missing stage. Delivery, reference, relevance, and selection ratios remain separate. Unknown denominators are `null` with a reason; no combined score exists.

Unmanaged observations use `prepared -> referenced`, never E1–E4. Preparation proves hook-side construction; reference proves only a matching marker in bounded Stop output. Lervo neither rewrites nor stores that output.

## 4. Capability decisions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

[Capability packages](execution/capabilities.md) cover skills, MCP servers, plugins, and bundles. Verified metadata supports deterministic natural-language selection. Recommendation, selection, load, activation, and invocation remain separate evidence; none proves semantic model use.

Built-in `1.0.0` templates are developer, researcher, marketer, designer, writer, and ideation. Lazy tracked repository roles under `.lervo/roles/` may be complete, specialize one exact version, or compose multiple exact versions. Final profiles and evaluation bundles must validate; ancestry must be acyclic and at most eight levels deep. Capabilities and verification-failure policy merge to the most restrictive result. The resolved definition and ancestry receive a deterministic contract hash. Agent, assignment, handoff, and managed-run transitions fail before provider creation when the bound version, contract hash, profile hash, or capability hash is stale.

Write approval binds project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation. Revalidate it immediately before mutation.

## 5. Provider adapters

Codex and Claude share contract tests and normalize native session, capability activation, tool, usage, error, and result events without inventing telemetry. Provider-specific MCP configuration, plugin loading, and confirmation remain behind adapter boundaries.

Terminal profiles merge approved handlers into project arrays while preserving settings and hooks. Handlers resolve the Git root from the provider working directory and invoke the generated terminal-only bundle through Node, never a PATH-resolved global `lervo`. The bundle verifies its exact manifest before handling input. Legacy contract-v1 handlers migrate in place; generated-only runtime upgrades reconcile automatically. Reconciliation plan IDs bind exact target bytes and the latest canonical terminal-application event ID, allowing an old-to-new transition to recur safely after an intervening version without colliding with earlier recovery evidence. A changed event head makes the plan stale. User-owned provider configuration changes retain exact approval. Invalid JSON or shapes, conflicting Lervo commands, Claude disablement, or Codex project-hook disablement blocks migration. Authority excludes local, global, and organization settings. Successful apply is installation evidence, not activation readiness: human and JSON output must immediately disclose Codex's one-time `/hooks` review. `terminal status` remains `action_required` until canonical contract-v2 invocations for both events are observed, distinguishing an unreviewed or unobserved Codex hook from a stale repository lifecycle.

Managed runs use a role-bound English machine-result protocol. A separate read-only session of the selected local provider evaluates human-facing publication in an empty temporary repository without documents, tools, or write access. Its exact JSON is content-bound evidence—not independent cross-provider or human review, proof of understanding, or writing-policy E3. Failure blocks publication and CLI success, but not an already verified file change.

The validated result is the E4 source. Before publication, remove only exact evidence tokens for current E3 versions and store the human artifact under a separate digest. Writing checks, permits, `run.completed`, and display bind to that projection. `adapter.result.captured` retains the unprojected digest without content. Unknown tokens remain visible; an empty projection fails closed.

## 6. Repository snapshots and writes

Plans bind state, expected paths, before and desired hashes, and verification. Apply rejects symlinks, escape, changed targets, unapproved paths, and stale plans.

Snapshots cover repository-authored files, excluding Lervo runtime data and state, dependencies, and conventional generated build or cache directories. Source and tracked generated files remain covered.

User content changes only through explicit content-bound operations. Managed blocks preserve outside bytes. Generated files may change or be deleted only when recorded generation proves current-hash ownership.

Repository assignments bind role ID, role version, role contract hash, dependencies, acceptance, verification, approvals, workstream, and expected paths. A short atomic lease permits exactly one current holder for overlapping path scopes; disjoint scopes may execute concurrently. Root agents and subagents use the same lease and handoff contract. Managed execution revalidates the exact active lease, provider, role contract, path, and suite set before provider creation. Expiry permits generation-incremented recovery and never proves the former holder stopped external work.

## 7. Verification

Suites declare exact commands, working directories, limits, and outcomes. Lervo compares pre- and post-snapshots and rejects unexpected changes. Bounded command output is artifact data, not event content.

## 8. Repository knowledge

Tracked scanner, publication, language, taxonomy, routing, and leaf bounds govern knowledge. Documentation stays under `docs/`; `.lervo` stores policy, provenance, manifests, and rebuildable state. V1 publishes English with deterministic sharding.

Structural planning is read-only. Generated changes and user bytes require current bindings and exact approval where specified. Unknown or tied classifications, unsafe sources, provider-specific enforcement, and over-capacity layouts fail closed. Isolated no-capability semantic compilation and normalization retain complete source-unit coverage; provider output and successful materialization are not semantic truth.

Document normalization uses batches of at most two documents and 32 KiB of source bytes, with at most three provider processes. Exact validated results use a compiler-and-input-bound `document-v2` cache independent of the repository snapshot; final candidates and approvals always rebind the complete current snapshot. A failed multi-document batch subdivides once into sequential single-document calls; completed documents persist immediately, and a failed single document ends the attempt. Count-only progress goes to stderr in human and JSON modes and is not an event.

The [repository knowledge compilation specification](../specs/repository-knowledge-compilation.md) defines candidates, approvals, durable apply, lifecycle, skill resources, entrypoints, splits, bridges, agent surfaces, and recovery rules.

## 9. Entrypoints and language

README is concise human onboarding; AGENTS is concise provider-neutral guidance; CLAUDE is a thin AGENTS bridge. Generated publications use a versioned catalog and tracked language. Normalization uses that language and a versioned profile; v1 supports English. Neutral localized titles preserve exact encoded paths. Human writing binds `publication.language` to `writing_en-human`, semantic checks, policy hash, evaluation, and permit. Deliberation carries locale through profiles, prompts, verdicts, evaluation, and publication. Unsupported locales fail before execution; provider prose never implies approval. Initialization creates minimum configuration; feature and state directories remain lazy.

Durable local data and rebuildable projections follow the [state lifecycle specification](execution/state-lifecycle.md).

## 10. Events and privacy

The [execution events and privacy specification](execution/events-and-privacy.md) defines allowlisted payloads, workforce events, knowledge and terminal integration events, additive terminal observation compatibility, workstream snapshots, activation receipts, coverage, privacy exclusions, and failure meaning. Events remain canonical hash-chained evidence; absent telemetry never becomes inferred success or provider-use claims.

## 11. Durable apply and recovery

The owner-only journal validates the plan and current bytes, stages outputs, backs up originals, publishes or deletes, lints, commits the event, then cleans backups and empty parents. Pre-commit failure restores originals. Post-commit cleanup failure preserves outputs and requires recovery. Interrupted transactions block mutation. Rollback recreates only parents pruned by that transaction before restoring exact backups, including deleted shards and moved documents.

## 12. Hub and remote execution

Hub and Node coordination remains authenticated, project-scoped, local-policy-bound, and independent of a specific network. Event streams, repository-scoped workstream replication, remote authority, runtime health, and service stability are defined in the [Hub and Node coordination specification](coordination/hub-and-node.md).

Repository Node apply revalidates a secret-free plan, installed payload, owner-only config, canonical service hash, and identity. It requires three stable manager and complete runtime observations before fleet registration; failure restores the prior verified state or remains unknown. `lervo upgrade` also binds the CLI build and subsystem plans, permits at most sixteen generated-only stages before lint, and compares registered Node payload hashes. User/provider bytes, trust, credentials, publication, onboarding, and legacy transitions retain separate authority. Local output excludes secrets, and no wrapper event duplicates inner evidence.

Repository workforce state uses durable role and agent identity, bounded parent depth, assignments, dependency and path scopes, short scheduler locks, renewable generation-bound leases, exact evidence handoffs, and CAS finalization. Same-role and mixed-role agents execute concurrently only on disjoint scopes. Root agents and subagents use identical transitions. `assignment.lease.renewed` retains assignment, agent, lease, generation, and expiry only; it excludes task prose, paths, prompts, output, reasoning, and credentials. Missing or rejected renewal leaves the prior lease authoritative until its recorded expiry.

## 13. Failure categories

| Category | Required behavior |
| --- | --- |
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

Verification covers schema and redaction tests; shared adapter contracts; write and recovery failure injection; transient service compensation and readiness; synchronization empty-outbox, long-chain, gap, and cursor-conflict tests; knowledge plan, apply, lint, and idempotence; source privacy, path, symlink, size, and race tests; and applicable boundary, type, documentation, build, and distribution checks.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Hub and Node coordination](coordination/hub-and-node.md)
- [Capability package supply chain](execution/capabilities.md)

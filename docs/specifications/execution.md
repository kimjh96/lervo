# Lervo Execution and Evidence Specification

Status: `active`  
As of: 2026-08-24

## 1. Scope

This specification defines Lervo's provider-neutral contracts for managed runs, evidence, documents, knowledge, telemetry, and recovery. ADRs retain historical rationale.

## 2. Managed run lifecycle

```text
requested -> resolved -> context prepared -> provider started
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among required contracts, capability decisions, context evidence, provider results, repository snapshots, and verification results. Provider work outside this lifecycle is `unmanaged`.

Managed search records bounded operational and repository-knowledge recommendation attempts separately. When an AGENTS instruction or registered document appears in both views, both must resolve to the same canonical document ID and carry identical knowledge metadata through discovery, recommendation, selection, loading, and injection. Unproven same-path identity fails before a provider turn.

## 3. Context evidence

| Level | Meaning |
|---|---|
| E0 | Candidate discovered. |
| E1 | Candidate selected by policy. |
| E2 | Current bytes loaded and validated. |
| E3 | Adapter acknowledged the exact delivered envelope. |

E3 proves injection, not understanding or use. Claims of `referenced` or `used` require provider-native telemetry.

## 4. Capability decisions

Every role must declare `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network access, external messages, deployments, and data changes. Missing policy is an error.

Write approval binds the project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation state. The write bridge revalidates approval immediately before changing bytes.

## 5. Provider adapters

Codex and Claude adapters share common contract tests. They normalize native session, tool, usage, error, and result events without inventing unavailable telemetry. Provider-specific settings and discovery files remain behind adapter or profile boundaries.

An ordinary managed run formats its machine result with a role-bound English result protocol. A separate read-only session of the selected local provider evaluates human-facing publication. It runs in an empty temporary repository without repository documents, tools, or write access. Its exact JSON response becomes content-bound evaluation evidence. This is not independent cross-provider review, human review, proof of understanding, or writing-policy E3 injection. Evaluation failure blocks publication and CLI success, but not an already verified file change.

## 6. Repository snapshots and writes

A managed write plan identifies current repository state, expected paths, before and desired hashes, and verification requirements. Apply rejects symlinks, path escape, changed targets, unapproved paths, and stale plans.

Before-and-after snapshots cover repository-authored files. Runtime state, dependency trees, and conventional generated build or cache directories are explicit non-observation boundaries. Their omission bounds snapshots while retaining unmanaged-change detection for source and tracked generated files.

User-owned content changes only through an explicit content-bound operation. Managed blocks preserve every byte outside their exact CommonMark range. A Lervo-generated file may be updated or deleted only when a recorded generation contains its current hash.

## 7. Verification

A verification suite declares exact commands, working directories, limits, and required outcomes. Lervo snapshots before and after execution and rejects unexpected repository changes during verification. Command output is bounded artifact data, not event-payload content.

## 8. Repository knowledge

`.lervo/knowledge/policy.yaml` defines scanner limits, exclusions, publication root, language, and navigation bounds. `.lervo/knowledge/document-layout.yaml` separately defines decision and legacy roots, semantic routes, deterministic routing evidence, and leaf bounds. Version 1 accepts only `publication.language: en`.

Human navigation defaults to `docs/knowledge`. `.lervo` stores policy, provenance, manifests, and rebuildable local state, not hidden human documentation. ID registries use deterministic two-hex fan-out; decision sources use semantic groups limited to 24 ADRs per leaf.

Structural migration remains read-only until the same current plan ID is applied. It may inventory bounded sources; generate navigation and sidecars; create missing README and AGENTS entrypoints; shard navigation; route ADRs by explicit repository route or one strongest configured title-term match with per-document approval; route included non-entrypoint Markdown into `docs/<route>/`; treat substantive legacy `docs/README.md` as content; honor safe `lervo.document.route` and optional `lervo.document.filename`; move Claude rules to `docs/instructions/<route>/` and skills to `.agents/skills/`; refresh AGENTS routing and the CLAUDE-to-AGENTS bridge with exact approval; relocate legacy machine artifacts; and delete outputs owned by a prior manifest.

It must not alter user bytes without an exact item hash, expose secrets or raw logs, claim semantic truth, translate provider enforcement settings, or use a catch-all route. Unknown, ambiguous, invalid, or over-capacity routes block apply. Configuration-only surfaces remain local inventory.

After routing is current, document normalization runs Codex or Claude through the same external no-capability adapter. Stored candidates rewrite eligible ordinary Markdown into the configured language and audience profile. Multi-topic sources may retain a short entrypoint and split into bounded grouped topics; handoffs go under `docs/repository/handoffs/`. Every source section maps through a validated document-local integer index to its content-bound unit version. Managed blocks, provider imports, README-to-AGENTS routing, portable skill identity, fenced examples and links in skills or instructions, and inline coordinates in portable skill material must survive. Other examples may be condensed only at the exact human-review boundary. Skill lifecycle binds resource hashes without rewriting scripts or assets.

Each source rewrite needs its own approval hash. Schema-valid shard results are cached in content-bound ignored state and invalidate when the envelope or compiler build changes. No more than three isolated shards run concurrently. Loading revalidates candidate structure and content bindings against all eligible sources and skill resources. Apply uses the stored candidate, durable journal, sharded lineage, exact-result lint, and privacy-bounded materialization evidence; it never reinvokes the provider. Changed outputs or resources become stale. Output, coverage, or successful apply does not prove semantic truth or equivalence; the reviewer owns that judgment.

Semantic compilation uses an installed provider in a temporary workspace with filesystem, shell, network, external actions, and tools disabled. Version 1 emits English, source-cited candidates. Reconciliation and human review precede materialization.

See [repository knowledge compilation](../specs/repository-knowledge-compilation.md).

## 9. Entrypoints and language

- README provides concise human onboarding.
- AGENTS provides concise provider-neutral operational guidance.
- CLAUDE is a profiled AGENTS bridge and does not duplicate policy.
- Generated publications use a versioned message catalog and tracked language tag.
- Reviewed normalization uses that tag and a separate versioned format profile; v1 supports English.
- Incompatible source titles receive localized neutral navigation titles while exact encoded source paths remain evidence.
- Human writing resolves from tracked `publication.language`. V1 binds `writing_en-human`, semantic checks, policy hash, evaluation, and publication permit to the artifact.
- Structured deliberation passes locale through profiles, prompts, verdict parsing, evaluation, and publication. Unsupported locales fail before provider execution; provider prose never implies approval.

Initialization creates minimum configuration only. Feature and state directories appear with their first artifact.

## 10. Events and privacy

Events use schema-specific allowlists and a validated hash chain. Ordinary payloads exclude raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted errors.

Every event or state defines its name and schema version, identifiers and hashes, privacy behavior, success meaning, and failure or retry meaning.

`knowledge.materialization.applied` records operation kind, plan and snapshot bindings, compiler identity, coverage, privacy-bounded counts including deletions, registry digests, validation artifact coordinates, and application time.

## 11. Durable apply and recovery

The owner-only materialization journal records:

1. plan and current-byte validation;
2. desired-output staging;
3. original-byte backup;
4. staged publication or deletion;
5. deterministic lint;
6. event commit;
7. backup and empty generated-parent cleanup.

Failure before event commit restores originals. Failure after commit preserves outputs and requires explicit cleanup recovery. An interrupted transaction blocks mutation until recovery. Rollback recreates only repository parents pruned by that transaction before restoring exact backups, including deleted shards and moved documents.

## 12. Hub and remote execution

Hub operations authenticate before source access and scope storage queries by project. Commands bind signature, signer purpose, target node, project, issue/not-before/expiry times, nonce, idempotency key, requested capability, and content-addressed artifacts.

A node validates trust, signature, scope, freshness, replay state, repository registration, manifest identity, local policy, approval, and snapshot. Transport grants no authority.

After authenticated registration, outbound sync compares the Hub cursor with the exact local event at that sequence and fails closed on mismatch. It queues at most one configured batch of later local events for the Node's explicit destination and uses lease-bound delivery. Reconciliation is restartable and producer-neutral; local commands neither read Hub credentials nor wait for the Node. Cycle output may contain only `enqueuedCount` and existing bounded status or count fields, never event identities, payloads, paths, repository coordinates, endpoints, credentials, or peer identities.

User service installation requires an explicit canonical definition and write authority. A newly activated Hub or Node must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart. Transient activity invokes fail-closed compensation for a newly created service. Removal permits six observations and requires three consecutive stopped observations before definition deletion. Stabilization proves OS service continuity only; separate identity-bound Hub or live-process Node preflight proves readiness.

## 13. Failure categories

| Category | Required behavior |
|---|---|
| Invalid contract or policy | Fail before provider or write execution. |
| Stale plan or snapshot | Produce a new read-only plan. |
| Approval missing or revoked | Deny the capability. |
| Provider telemetry incomplete | Lower assurance; infer neither success nor use. |
| Verification failure | Do not emit successful completion. |
| Event commit failure | Roll back pre-commit bytes. |
| Post-commit cleanup failure | Preserve committed bytes and require recovery. |
| Remote effect uncertain | Record uncertainty; do not retry automatically. |
| Secret or unsafe source | Exclude content; retain bounded diagnostics only. |

## 14. Required verification

- Schema validation and redaction tests.
- Provider-adapter common contract tests.
- Write and recovery failure-injection tests.
- Transient service activation, compensation, and separate readiness tests.
- Empty-outbox, bounded long-chain, existing-gap, and cursor-conflict synchronization tests.
- Knowledge plan, apply, lint, and idempotence tests.
- Source privacy, path safety, symlink, size, and race tests.
- Applicable package-boundary, type, documentation lifecycle, build, and distribution checks.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)

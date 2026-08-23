# Lervo Execution and Evidence Specification

Status: `active`
As of: 2026-08-24

## 1. Scope

This specification defines the provider-neutral managed-run, evidence, document, knowledge, telemetry, and recovery guarantees. Detailed historical rationale lives in ADRs; this file is the current contract.

## 2. Managed run lifecycle

```text
requested -> resolved -> context prepared -> provider started
-> provider result observed -> repository verified -> completed
```

A run may complete only when its required contracts, capability decisions, context evidence, provider result, repository snapshot, and verification result agree. Direct provider work outside this lifecycle is `unmanaged`.

Managed search records separate bounded operational and repository-knowledge recommendation attempts. If an AGENTS instruction or registered document is also returned as repository knowledge, both views must resolve to the canonical document ID and carry identical knowledge metadata across discovery, recommendation, selection, loading, and injection. Same-path candidates that cannot be demonstrated to be the same canonical document fail before a provider turn.

## 3. Context evidence

| Level | Meaning |
|---|---|
| E0 | A candidate was discovered. |
| E1 | Policy selected the candidate. |
| E2 | Current bytes were loaded and validated. |
| E3 | The adapter acknowledged the exact delivered envelope. |

E3 proves injection, not later understanding or use. Provider-native telemetry is required for `referenced` or `used` claims.

## 4. Capability decisions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads, filesystem writes, shell processes, network access, external messages, deployments, and data changes. Missing capability policy is an error.

Write approval is bound to project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation state. The write bridge revalidates approval immediately before changing bytes.

## 5. Provider adapters

Codex and Claude adapters implement the same common contract tests. Native session, tool, usage, error, and result events are normalized without inventing unavailable telemetry. Provider-specific settings and discovery files stay behind their adapter or profile boundary.

An ordinary managed run formats its machine result with a role-bound English result protocol, then evaluates any human-facing publication in a separate read-only session of the selected local provider. The evaluator runs in an empty temporary repository, receives no repository documents or tools, and cannot write. Its exact JSON response is parsed into content-bound evaluation evidence; it is not independent cross-provider review, human review, proof of understanding, or writing-policy E3 injection. Missing or failed evaluation blocks only publication and CLI success, not the already verified file change.

## 6. Repository snapshots and writes

A managed write plan identifies current repository state, expected paths, before hashes, desired hashes, and verification requirements. The apply boundary rejects symlinks, path escape, changed targets, unapproved paths, and stale plans.

Before/after snapshots cover repository-authored files but omit runtime state, dependency trees, and conventional generated build/cache directories. These omissions are explicit non-observation boundaries; they prevent installed dependencies and native build artifacts from exhausting the bounded snapshot while preserving unmanaged-change detection for source and tracked generated files.

User-owned content can change only through an explicit content-bound operation. Managed blocks preserve all bytes outside their exact CommonMark range. Lervo-generated files can update or delete only when a recorded generation contains the current hash.

## 7. Verification

A verification suite declares exact commands, working directories, limits, and required outcomes. Lervo snapshots before and after execution and rejects results if the repository changes unexpectedly during verification. Command output is stored as bounded artifact data, not copied into event payloads.

## 8. Repository knowledge

`.lervo/knowledge/policy.yaml` defines scanner limits, exclusions, publication root, language, and navigation bounds. `.lervo/knowledge/document-layout.yaml` independently defines the repository's decision root, legacy roots, allowed semantic routes, deterministic routing evidence, and leaf bound. Version 1 accepts only `publication.language: en`.

Human-facing generated navigation defaults to `docs/knowledge`; `.lervo` contains policy, provenance, manifests, and rebuildable local state rather than hidden human documentation. ID-addressed registries use deterministic two-hex fan-out, while decision sources use bounded semantic groups of at most 24 ADRs per leaf.

Structural migration is read-only until the same current plan ID is applied. It may:

- inventory bounded ordinary, sensitive, excluded, and unsupported sources;
- create or refresh generated navigation and sidecars;
- create missing README and AGENTS entrypoints;
- shard large navigation by entry and byte bounds;
- group flat ADRs through an explicit repository route or one strongest configured title-term match, with exact per-document approval;
- route discovered non-entrypoint Markdown from any included repository location into `docs/<route>/`, treating a substantive legacy `docs/README.md` as content rather than a basename exception and failing closed when the filename and H1 do not select one route;
- accept explicit `lervo.document.route` and an optional safe `lervo.document.filename` for agent-reviewed semantic classification and naming;
- move Claude behavioral rules to `docs/instructions/<route>/`, move Claude skill packages to `.agents/skills/`, and refresh the bounded AGENTS route block;
- normalize obsolete provider-surface references and append or refresh the CLAUDE-to-AGENTS managed import bridge under exact user-byte approval;
- relocate legacy flat machine artifacts to deterministic shards without claiming a user-document mutation;
- delete obsolete generated outputs whose ownership is established by a prior manifest.

It may not change existing user bytes without an exact item hash, expose secret or raw log bytes, claim semantic truth, translate provider enforcement settings, or send an unclassified document to a catch-all route. Unknown, ambiguous, invalid, or over-capacity routes block before apply. Configuration-only surfaces remain local inventory even when semantic rules and skills are normalized.

Semantic compilation runs an installed provider in a temporary workspace with filesystem, shell, network, external actions, and tools disabled. It emits English source-cited candidates in v1. Reconciliation and human review are required before materialization.

See [repository knowledge compilation](../specs/repository-knowledge-compilation.md).

## 9. Entrypoints and language

- README is concise, human-readable onboarding.
- AGENTS is concise, provider-neutral operational guidance.
- CLAUDE is a profiled bridge to AGENTS and does not duplicate policy.
- Generated publications use a versioned message catalog and the tracked language tag.
- Source titles may be preserved only when compatible with the selected generated-publication language; otherwise navigation uses a localized neutral title while retaining the exact encoded source path as evidence.
- Human-facing writing resolves from the tracked repository `publication.language`. Version 1 supports `en` and binds `writing_en-human`, its semantic checks, policy hash, evaluation, and publication permit to the resulting artifact.
- Structured deliberation passes the selected locale through role profiles, prompts, exact verdict parsing, the separate semantic evaluator, and publication. Unsupported locales fail before provider execution; provider prose is never inferred as an approval.

Initialization creates only minimum configuration. Feature and state directories are created when their first artifact is written.

## 10. Events and privacy

Events use schema-specific allowlists and a validated hash chain. Raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted error text do not enter ordinary event payloads.

Every new event or state must define:

1. name and schema version;
2. required identifiers and hashes;
3. privacy and redaction behavior;
4. success meaning;
5. failure and retry meaning.

`knowledge.materialization.applied` records operation kind, plan and snapshot bindings, compiler identity, coverage, privacy-bounded counts including deletions, registry digests, validation artifact coordinates, and application time.

## 11. Durable apply and recovery

The materializer journals stages under owner-only local state:

1. validate plan and current bytes;
2. stage desired outputs;
3. move originals to transaction backup;
4. publish staged bytes or staged deletions;
5. run deterministic lint;
6. commit the event;
7. remove backup and empty generated parents.

A failure before event commit restores originals. A failure after event commit preserves committed outputs and requires explicit cleanup recovery. An interrupted transaction blocks new mutation until recovery resolves it.

Rollback recreates only validated repository parents that were pruned by the same transaction before restoring exact backups. This applies to deleted sharded artifacts and moved documents, so empty-directory cleanup cannot make rollback impossible.

## 12. Hub and remote execution

Hub operations authenticate before source access and enforce project scope in storage queries. Commands carry signature, signer purpose, target node, project, issue/not-before/expiry times, nonce, idempotency key, requested capability, and content-addressed artifacts.

A node checks trust, signature, scope, freshness, replay state, repository registration, manifest identity, local policy, approval, and snapshot before execution. Network transport does not confer authority.

After authenticated registration, outbound sync compares the Hub cursor with the exact local event at that sequence and fails closed on mismatch. It then enqueues at most one configured batch of subsequent local events for the Node's explicit destination and runs the existing lease-bound delivery. This reconciliation is restartable and producer-neutral: local commands never read Hub credentials or wait for the Node. Cycle output may include only `enqueuedCount` and existing bounded status/count fields; it excludes event identities, payloads, paths, repository coordinates, endpoints, credentials, and peer identities.

User service installation requires an explicit canonical definition and write authority. A newly activated Hub or Node service must remain installed, enabled where applicable, and active across three observations separated by 500 milliseconds. A transient active state triggers the existing fail-closed compensation path for a newly created service. Removal permits up to six observations and requires three consecutive stopped observations before deleting the canonical definition. This stabilization proves only OS service continuity; operational readiness still requires the separate identity-bound Hub or live-process Node preflight.

## 13. Failure categories

| Category | Required behavior |
|---|---|
| Invalid contract or policy | Fail before provider or write execution. |
| Stale plan or snapshot | Produce a new read-only plan. |
| Approval missing or revoked | Deny the capability. |
| Provider telemetry incomplete | Lower assurance; do not infer success or use. |
| Verification failure | Do not emit successful completion. |
| Event commit failure | Roll back pre-commit bytes. |
| Post-commit cleanup failure | Preserve committed bytes and require recovery. |
| Remote effect uncertain | Record uncertainty and do not retry automatically. |
| Secret or unsafe source | Exclude content and retain bounded diagnostics only. |

## 14. Required verification

- Schema validation and redaction tests.
- Provider adapter common contract tests.
- Failure-injection tests for write and recovery checkpoints.
- Transient service activation and compensation tests plus separate runtime readiness checks.
- Empty-outbox discovery, bounded long-chain reconciliation, existing-gap, and Hub/local cursor-conflict sync tests.
- Repository knowledge plan/apply/lint/idempotence tests.
- Source privacy, path safety, symlink, size, and race tests.
- Package-boundary, type, documentation lifecycle, build, and distribution checks appropriate to the change.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)

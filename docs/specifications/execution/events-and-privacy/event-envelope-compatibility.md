# Event envelope compatibility

## Readers and writers

The shared reader accepts envelope schema versions 1 through 10. It preserves valid mixed hash chains without rewriting bytes or meaning. Version 1 remains the default writer; activated managed execution writes version 2. Version 3 adds bounded [supervision payloads](../outcome-supervision/contracts.md); versions 1 and 2 cannot carry these event types.

The SQLite adapter supports explicitly selected version 3 writes and rejects new events above the selected writer version. Reader capability advertisement alone does not activate writing.

## Reader-first payloads

The version-3 reader also recognizes `conversation.repository_knowledge.resolved`: a content-bound or legacy-unavailable knowledge-job outcome containing completion hash, source event, job and agent IDs, terminal state, attempt count, bounded failure code, optional current knowledge snapshot hash, and timestamp.

The allowlist excludes request text, source bytes, provider output, credentials, and absolute paths. `current` requires a knowledge snapshot and no failure code. `pending_review`, `stale`, and `attention_required` are non-success states.

This is reader-first compatibility only. The installed conversation writer retains its earlier synchronous knowledge disposition until the isolated background lifecycle and reader rollout pass [ADR-0427](../../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md).

The same reader accepts the bounded `work.supervision.preflight.blocked` payload proposed by [ADR-0431](../../../decisions/execution/orchestration/governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md). ADR-0431 also records source implementation that retains bounded inspection evidence and unresolved barriers after supersession. This source behavior is distinct from installed activation: source tests establish neither reader-first deployment nor installed acceptance. ADR-0431 requires compatible readers before the writer, passing activation fixtures, a reviewed mandate, and an installed canary showing that a persistent blocker prevents repeated owner invocation and that exact repair permits at most one admitted continuation. This compatibility document does not establish deployed reader support or installed writer and retry-barrier activation.

## Native skill reader boundary

Schema 7 adds `terminal.skill.observed` and `terminal.skill.turn_assessed`. Schemas 1 through 6 reject these types. Reader capability advertisement does not activate their writer. The selected writer coordinate requires current evidence that every configured reader supports history through schema 7. Before activation, the resident keeps observations only in a bounded host-private projection. See [native terminal skill observation](../provider-adapters/native-skill-observation.md) for attribution, privacy, retention, and failure states.

## Repository activation

Schema 8 adds the practice-learning observation, candidate, usage and retirement events. Schemas 1 through 7 reject these types. Automatic activation requires support from every configured reader. An older configured reader keeps the writer at its current version. The resident retains bounded local practice state while activation waits. See [practice learning](../../knowledge/practice-learning.md) for payloads and privacy.

Schema 9 adds the plan ledger events of [ADR-0563](../../../decisions/foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md): `plan.item.captured`, `plan.item.updated`, `plan.item.closed`, `plan.summary.gap`, `plan.turn.blocked` and `plan.item.missed`. Schemas 1 through 8 reject these types. The ledger is the fold of its events, so until the writer selects schema 9 a ledger write fails with `plan_ledger_inactive` and nothing is kept elsewhere. See [the plan ledger](../../knowledge/plan-ledger.md) for payloads and privacy.

Schema 10 adds the hosted session events of [ADR-0613](../../../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md): `application.workspace.started`, `terminal.session.launch_prepared`, `terminal.session.launched`, and `terminal.session.ended`. Schemas 1 through 9 reject these types. A session appears only as `providerSessionDigest`, the SHA-256 digest of the provider session UUID that Lervo prepared. No payload carries instruction text, launch arguments, environment values, or paths. Automatic activation targets schema 10 under the same reader rule. Writers record these events only while the writer selects schema 10. See [ADE sessions](../product-surfaces/ade-sessions.md) for payloads and privacy.

Repository activation supports explicit `--schema-version 3` with fresh authoritative evidence that all required readers support versions 1, 2, and 3. Its coordinate uses schema version 2. Existing version 1 coordinates and version 2 activation identifiers retain their meaning.

The default activation target remains version 2. Production Node supervision composition remains open. Existing lower-version drafts retain their established behavior; version 3 does not silently rewrite them.

## Validation boundaries

A supported but malformed envelope is `event_invalid` at the event-contract boundary and an integrity failure where stored bytes are decoded.

An unknown integer envelope version is `event_schema_unsupported`; local storage, sync, and Hub intake reject it before mutation. Invalid hashes and payload allowlists remain integrity failures, not unsupported-version failures.

## References

- [Version 2 payload contracts](event-envelope-compatibility/payload-contracts.md)
- [Validation and evidence boundaries](event-envelope-compatibility/validation-and-evidence.md)

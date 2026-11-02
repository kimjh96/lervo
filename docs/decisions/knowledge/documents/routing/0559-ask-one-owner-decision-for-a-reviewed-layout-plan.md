# ADR-0559: Ask one owner decision for a reviewed layout plan

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0540](0540-account-for-every-document-a-migration-defers.md) (outside-root moves), [ADR-0476](../0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) (layout approval)
Contract: [Layout and routing](../../../../specs/repository-knowledge-compilation/structural-publication/policy/layout-and-routing.md), [continuity](../../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md)

## Context

A `review_required` repository layout plan asks one `--approve-item <operation-id>=<approval-hash>` per user-document move or update. On 2026-11-02 the argo plan (`klayout_45d4edc791ceb07c86a000ac`) carried 19 semantic moves, so the owner had to copy 19 exact flags.

The same moves also reached the owner a second time. The classified documents sit outside the delegation's roots, so the renewal writer proposed adding every source, destination, and reference-rewrite file to `normalizationRoots`. argo needed 78 paths against the 32-root limit, so the proposal carried `acceptanceBlocker: normalization_root_limit`. ADR-0540 says such a proposal "cannot be accepted until a separate authority-contract review". It stayed an owner decision that no answer could settle.

Attention showed only `repository_layout_review_required` with `lervo migrate knowledge` and no consequence, so the health owner-authority line never named it. `lervo upgrade` printed a generic "requires its separately displayed exact approval". The owner was a review queue for one layout choice, and Lervo gave no recommendation they could act on.

## Decision

### One decision per plan

A `review_required` layout plan with no blockers and at least one item approval is asked as one decision:

- `decisionHash` is the SHA-256 of the canonical `{ sourceSnapshotId, afterSourceSnapshotId, approvals }`, where `approvals` lists every move and user update `operationId` with its `approvalHash`, sorted. It binds the exact source bytes, the exact resulting bytes including reference rewrites, and every item approval.
- `decisionId` is `klaydec_` followed by 24 hex characters derived from `decisionHash`.
- Deferral labels are excluded. They change with provider availability, and a decline must not be asked again only because a provider paused.
- The decision recommends acceptance and summarizes the move count, the largest destination directories (at most 8), user-document updates, and reference rewrites.

### One accept command, one decline command

- Both commands carry `--root <repository>`, so they act on the right repository from any working directory.
- `lervo migrate knowledge --accept-layout <decisionId>=<decisionHash>` rebuilds the plan. If the token names the current decision, the command applies the plan with every item approval. This is exactly what passing each displayed `--approve-item` with `--apply <planId>` grants, through the same apply, lint, journal, and receipt.
- `lervo migrate knowledge --decline-layout <decisionId>` records the decline and changes no repository bytes.
- A malformed or stale token grants nothing. The flags cannot be combined with each other, with `--apply`, or with `--approve-item`. They work only when the layout stage is the pending stage; an earlier pending stage reports that the decision was not used.
- Per-item approval stays available for an owner who wants to choose items.

### Where the decision appears

- The plan text prints `Layout decision`, the summary with `Recommendation: accept`, and both commands.
- Terminal lifecycle inspection reports `repository_layout_decision_pending` instead of `repository_layout_review_required`. The command is the accept command plus the decline command, and the detail is the summary. Attention attributes it to the owner with consequence `repository_write`, so the existing health owner-authority line names it with the accept command.
- `lervo upgrade` reports the knowledge stage as `pending_authority (layout_decision_pending)` with the summary and both commands. The other stages converge independently, as before.
- A declined decision is no longer asked. The later knowledge stages wait behind the layout stage and stay uninspected, so `lervo upgrade` reports the knowledge stage as `deferred (layout_decision_declined)`, not current, and attention keeps one non-gating `repository_layout_decision_declined` advisory with the accept command. A changed plan is a new decision and is asked again.

### Decline record

Declines are stored in host-private `.lervo/state/knowledge/layout-decision.json` as `{ schemaVersion: 1, declined: [{ decisionId, declinedAt }] }`, keeping the newest 32. They are host-private because the plan itself depends on host-private classification records (ADR-0476), so another host can compute a different plan. An unreadable or invalid file means no decline is recorded, so the decision is asked again; this never grants anything. No event type is added.

### Over-limit scope proposals are not asked

A `delegation_scope_change` proposal with `acceptanceBlocker: normalization_root_limit` becomes an `info` finding. It stays in the continuity projection as evidence. Its remediation text points to the layout decision, because the owner can move the same documents once through the foreground plan, whatever the delegation's roots. Proposals within the limit keep the ADR-0540 scope path. The 32-root limit is unchanged, and no directory or partial grant is added.

A document still waiting for classification outside the roots (`delegation_scope` deferral) now says that its move joins the layout decision once classified, or the next renewal's scope proposal when that fits the limit.

## Consequences

- argo's 19 approvals become one decision with one accept command and one decline command, and the unanswerable 78-path scope question disappears.
- The decision can be answered from any terminal session that shows attention or health.
- Discord does not show it yet. No owner decision of any kind reaches Discord today; document freshness approvals wait for the same ADR-0453 escalation path. The decision uses the attention projection that path will consume, so it needs no change of its own when that path ships.

## Verification

- `apps/cli/test/repository-layout-decision.test.ts`: plan text and terminal attention show the decision and its commands, and acceptance applies the move and rewrites the reference. A stale or combined decision grants nothing. A decline leaves files unchanged and removes the attention item until a changed plan creates a new decision.
- `apps/cli/test/operating-attention-ownership.test.ts`: the attention item is owner work with consequence `repository_write` and the accept command as its inspect command.
- Read-only check on argo after release: `lervo migrate knowledge` prints one decision for its 19 moves, and `lervo upgrade` reports `layout_decision_pending` with both commands.

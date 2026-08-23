# ADR-0031: Human-reviewed knowledge promotion and path-based staleness

Status: `accepted`
Decision date: 2026-08-19

## Context

A converged candidate is not automatically verified project knowledge. Promotion must prove human review, current repository state, and conflict resolution. After promotion, unrelated revision changes should not stale all knowledge, but affected-path baseline hashes are necessary to prove relevant change.

## Decision

### Separate review and promotion sources

- `KnowledgePromotionPolicy` names allowed human reviewers and conflict requirements. Its version hashes the canonical snapshot excluding version.
- Immutable CAS `KnowledgeReviewApproval` binds candidate ID/hash, approve/reject decision, reviewer, policy snapshot, reviewed revision, resolved conflicts, and time. Its ID hashes remaining canonical content including reviewer/policy.
- `knowledge.candidate.reviewed` records only candidate/approval/policy/revision IDs and hashes. Reviewer identity remains only in local approval CAS. Rejections are review sources but cannot promote.

### Verified source binds approval and current paths

Promotion revalidates candidate CAS/event/evidence/decision source plus approval CAS/review event. Require currently allowed reviewer, `approved`, all required conflicts resolved, identical candidate/approval/current revision, and every affected path present.

The verified source records candidate/approval CAS coordinates, claim digest, per-path baseline hashes, evidence events, verified revision, review interval, and time. `knowledge.verified` records only source ID/hash. Never mutate candidate, approval, or user documents.

### Evaluate paths and review due date, not revision alone

From verified source and current snapshot, remain `current` when all connected hashes match and review is not due even if repository revision changed. Become `stale` when a connected path changes/disappears or due time arrives.

Store a small derived CAS result with overall state, two signals, changed/missing paths, and fixed reasons; reject contradictory combinations. Do not accumulate events for `current`; emit `knowledge.stale.detected` only for stale.

### Events and failures

| Event | Coordinates | Excluded |
| --- | --- | --- |
| `knowledge.candidate.reviewed` | candidate/approval IDs/hashes, decision, policy ID/version, revision, resolved conflicts | reviewer and review prose/source |
| `knowledge.verified` | knowledge/candidate/approval IDs/hashes, claim digest, paths, verified revision | claim/decision source, reviewer |
| `knowledge.stale.detected` | knowledge/result IDs/hashes, verified/current revisions, reasons, changed/missing paths | file source, absolute paths, user prose |

Reject artifacts whose IDs cannot be recomputed from content hashes. CAS without its state-transition event is not authoritative when event recording fails.

- `review_contract_invalid`: invalid policy/reviewer/revision/conflicts/approval
- `promotion_not_eligible`: approval, candidate, snapshot, or coordinates disagree
- `staleness_contract_invalid`: verified source, snapshot, or state/signal/reason disagree
- `artifact_storage_failed`: review/verified/stale CAS failure
- `event_recording_failed`: state event failure; return no completion

SQLite/CAS fixtures cover authorized approval and promotion, unauthorized/rejected/unresolved/mixed-revision/missing-path failures, unrelated changes remaining current, connected change and exact due time becoming stale, contradiction rejection, and doctor traversal of all links.

## Consequences

Promotion binds human approval to current repository evidence. Every source remains a separate CAS object rather than one ever-growing knowledge file.

# ADR-0031: Human-reviewed knowledge promotion and path-based staleness

Status: `accepted`
Decision date: 2026-08-19

## Context

A converged candidate is not automatically verified project knowledge. Promotion must establish human review, current repository state, and conflict resolution. After promotion, unrelated revision changes must not stale all knowledge; affected-path baseline hashes identify relevant changes.

## Decision

### Separate review and promotion sources

- `KnowledgePromotionPolicy` identifies allowed human reviewers and conflict requirements. Its version hashes the canonical snapshot excluding the version.
- Immutable CAS `KnowledgeReviewApproval` binds the candidate ID/hash, approve/reject decision, reviewer, policy snapshot, reviewed revision, resolved conflicts, and time. Its ID hashes the remaining canonical content, including reviewer and policy.
- `knowledge.candidate.reviewed` records only candidate, approval, policy, and revision IDs/hashes. Reviewer identity remains in local approval CAS. Rejections are review sources but cannot authorize promotion.

### Verified source binds approval and current paths

Promotion revalidates candidate CAS/event/evidence/decision sources and approval CAS/review event. It requires a currently allowed reviewer, an `approved` decision, resolution of every required conflict, identical candidate/approval/current revision coordinates, and presence of every affected path.

The verified source records candidate/approval CAS coordinates, claim digest, per-path baseline hashes, evidence events, verified revision, review interval, and time. `knowledge.verified` records only the source ID/hash. Candidate, approval, and user documents are immutable.

### Evaluate paths and review due date, not revision alone

Knowledge remains `current` when all connected hashes match and review is not due, even if the repository revision changed. It becomes `stale` when a connected path changes or disappears, or when the due time arrives.

Store a small derived CAS result containing overall state, two signals, changed/missing paths, and fixed reasons. Reject contradictory combinations. Emit no event for `current`; emit `knowledge.stale.detected` only for stale results.

### Events and failures

| Event | Coordinates | Excluded |
| --- | --- | --- |
| `knowledge.candidate.reviewed` | candidate/approval IDs/hashes, decision, policy ID/version, revision, resolved conflicts | reviewer and review prose/source |
| `knowledge.verified` | knowledge/candidate/approval IDs/hashes, claim digest, paths, verified revision | claim/decision source, reviewer |
| `knowledge.stale.detected` | knowledge/result IDs/hashes, verified/current revisions, reasons, changed/missing paths | file source, absolute paths, user prose |

Reject artifacts whose IDs cannot be recomputed from content hashes. CAS without its state-transition event is not authoritative when event recording fails.

- `review_contract_invalid`: invalid policy, reviewer, revision, conflicts, or approval
- `promotion_not_eligible`: approval, candidate, snapshot, or coordinates disagree
- `staleness_contract_invalid`: verified source, snapshot, or state/signal/reason disagree
- `artifact_storage_failed`: review, verified, or stale CAS failure
- `event_recording_failed`: state-event failure; return no completion

SQLite/CAS fixtures cover authorized approval and promotion; unauthorized, rejected, unresolved, mixed-revision, and missing-path failures; unrelated changes remaining current; connected changes and exact due time becoming stale; contradiction rejection; and doctor traversal of every link.

## Consequences

Promotion binds human approval to current repository evidence. Each source remains a separate CAS object rather than contributing to an ever-growing knowledge file.

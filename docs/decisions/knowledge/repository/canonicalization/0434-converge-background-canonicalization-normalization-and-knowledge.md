# ADR-0434: Converge background canonicalization, normalization, and knowledge

Status: `accepted`
Decision date: 2026-09-27

## Context

The owner requested an implementation design that drains document debt without a later conversation and an audit of canonicalization and knowledge convergence. The [installed audit](../../../../evidence/quality/background-knowledge-convergence-audit.md) found 311 pending documents across seven repositories. All seven failed the read-only knowledge-currency check, including the two with no normalization debt.

ADR-0433 durably queues observed changes, but its worker can acknowledge a job as `pending_review` or `attention_required` without scheduling the remaining work. Canonicalization and normalization review are assigned to subsequent write-capable turns. Background normalization generation itself starts when a conversation turn asks for a candidate. No existing loop independently drains the entire baseline.

Two isolated probes also reproduce unsafe completion boundaries: source drift during semantic review can still settle `current`, and canonical-only changes can settle `pending_review` with no candidate. An empty operational queue therefore establishes neither semantic completion nor repository currency.

## Decision

Implement one provider-neutral convergence owner for each repository. It continuously discovers baseline debt and follows observed change obligations through canonical assessment, authorized canonical integration, normalization review and application, then ordered knowledge migration, bridge reconciliation, refresh, and lint. Stage workers retain separate responsibilities and durable assignments; the coordinator grants no new document-write authority.

The detailed contracts are:

- [Authority, review, integration, and completion](../../../../specs/background-knowledge-convergence/authority-and-completion.md).
- [Scheduling, recovery, events, and resource bounds](../../../../specs/background-knowledge-convergence/scheduling-and-events.md).
- [Delivery order and acceptance](../../../../roadmap/knowledge/autonomous-background-convergence.md).

### Continuous discovery and ownership

Startup, canonical event changes, and a bounded periodic inspection wake the owner. Discovery creates one source-bound baseline obligation for pre-existing debt, even when no user is speaking. A newer snapshot supersedes an older baseline explicitly; it never rewrites an old resolution.

Change jobs continue to originate in `repository.change.completed`. Outbox and scheduling projections remain rebuildable from canonical events. A durable handoff to the next stage must share the current stage's acknowledgement transaction. A candidate or an exhausted operation cannot consume the sole record of unfinished work.

### Separate generation from exact review

Normalization generation stays outside provider sandboxes. A separate assigned reviewer compares exact source and candidate bytes and produces per-source approvals or bounded rejections. No generator self-approves its output. A reviewed delegation permits this agent review without asking the user about every document; absent authority or conflicting user-owned content remains an explicit decision.

This amendment extends ADR-0195's semantic-review boundary to a specifically authorized independent agent. It does not treat model agreement, section coverage, or a successful provider call as semantic approval. Until implementation and activation are verified, the existing terminal and conversation review contract remains active.

Canonicalization receives the same independent continuation: semantic review must identify a durable candidate or prove source-bound coverage. A file's presence under a canonical directory does not establish that it records the changed fact. Authorized edits land through scoped workspace and integration contracts before exact-hash promotion.

### Truthful completion

`current` requires exact source and instruction currency at settlement, durable canonical dispositions, current selected normalization records, and ordered lifecycle receipts. Repository-wide currency additionally requires complete baseline coverage and no unresolved current semantic obligation. Partial progress remains partial.

Historical `repository.knowledge.resolved` outcomes remain immutable. New convergence outcomes reference them when recovering unfinished work. `pending_review` requires a non-null, readable, exact candidate or an explicit authority decision, plus a durable successor obligation. Unsupported source evidence can require attention, but must have an accountable owner and observable recovery condition.

## Compatibility and consequences

The owner authorized implementation on 2026-09-27. The [runtime contract](../../../../specs/background-knowledge-convergence/runtime.md) and [implementation evidence](../../../../evidence/quality/background-knowledge-convergence-implementation.md) record the local implementation and private installed canary. Production fleet activation remains pending. New event contracts require reader-first deployment and a separately reviewed writer transition. Existing services retain their current behavior. No project receives implicit document-write delegation, a new provider, or a larger spend allowance.

The design preserves local execution without a Hub, user-owned regions, exact approvals, isolated provider adapters, and the distinction between canonical Markdown and rebuildable projections. It adds automatic continuation and recovery without making background generated prose canonical by itself.

Acceptance must include idle repositories, concurrent user edits, restart during apply, provider limits, candidate rejection, opaque assets, legacy debt, and one installed no-Hub journey that reaches verified currency without another human turn.

## References

- [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)
- [ADR-0433](0433-own-background-knowledge-for-every-repository-change.md)
- [ADR-0195](../0195-reviewed-document-content-normalization.md)
- [ADR-0303](0303-branch-safe-knowledge-reconciliation-and-canonicalization.md)
- [Agent workspace and integration contract](../../../../specifications/execution/agent-workspaces.md)

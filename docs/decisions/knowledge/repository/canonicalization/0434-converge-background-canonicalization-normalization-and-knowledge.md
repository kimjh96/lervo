# ADR-0434: Converge background canonicalization, normalization, and knowledge

Status: `accepted`
Decision date: 2026-09-27
Amended by: [ADR-0469](../../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) (delegation continuity under an owner-installed host policy)

## Context

The owner requested a design to drain document debt without a later conversation and an audit of canonicalization and knowledge convergence. The [installed audit](../../../../evidence/quality/background-knowledge-convergence-audit.md) found 311 pending documents across seven repositories. All seven failed the read-only knowledge-currency check, including two without normalization debt.

ADR-0433 durably queues observed changes, but its worker can acknowledge `pending_review` or `attention_required` without scheduling remaining work. Canonicalization and normalization review await later write-capable turns; background normalization generation starts only when a conversation turn requests a candidate. No existing loop independently drains the entire baseline.

Two isolated probes exposed unsafe completion boundaries: source drift during semantic review can still settle `current`, and canonical-only changes can settle `pending_review` without a candidate. An empty operational queue proves neither semantic completion nor repository currency.

## Decision

Implement one provider-neutral convergence owner per repository. It continuously discovers baseline debt and follows observed change obligations through canonical assessment, authorized canonical integration, normalization review and application, then ordered knowledge migration, bridge reconciliation, refresh, and lint. Stage workers retain separate responsibilities and durable assignments. The coordinator grants no new document-write authority.

Detailed contracts:

- [Authority, review, integration, and completion](../../../../specs/background-knowledge-convergence/authority-and-completion.md).
- [Scheduling, recovery, events, and resource bounds](../../../../specs/background-knowledge-convergence/scheduling-and-events.md).
- [Delivery order and acceptance](../../../../roadmap/knowledge/autonomous-background-convergence.md).

### Continuous discovery and ownership

Startup, canonical event changes, and bounded periodic inspection wake the owner. Discovery creates one source-bound baseline obligation for pre-existing debt, even without an active user conversation. A newer snapshot explicitly supersedes an older baseline without rewriting its resolution.

Change jobs continue to originate in `repository.change.completed`. Outbox and scheduling projections remain rebuildable from canonical events. Durable handoff to the next stage must share the current stage's acknowledgement transaction. Neither a candidate nor an exhausted operation may consume the sole record of unfinished work.

### Separate generation from exact review

Normalization generation remains outside provider sandboxes. A separately assigned reviewer compares exact source and candidate bytes and produces per-source approvals or bounded rejections. Generators never approve their own output. Reviewed delegation permits agent review without asking the user about every document; absent authority or conflicting user-owned content remains an explicit decision.

This amendment extends ADR-0195's semantic-review boundary to a specifically authorized independent agent. Model agreement, section coverage, and successful provider calls do not constitute semantic approval. Existing terminal and conversation review contracts remain active until implementation and activation are verified.

Canonicalization receives the same independent continuation: semantic review must identify a durable candidate or prove source-bound coverage. Presence under a canonical directory does not establish that a file records the changed fact. Authorized edits land through scoped workspace and integration contracts before exact-hash promotion.

### Truthful completion

`current` requires exact source and instruction currency at settlement, durable canonical dispositions, current selected normalization records, and ordered lifecycle receipts. Repository-wide currency also requires complete baseline coverage and no unresolved current semantic obligation. Partial progress remains partial.

Historical `repository.knowledge.resolved` outcomes remain immutable. New convergence outcomes reference them when recovering unfinished work. `pending_review` requires a non-null, readable, exact candidate or an explicit authority decision, plus a durable successor obligation. Unsupported source evidence may require attention, but must have an accountable owner and observable recovery condition.

## Compatibility and consequences

The owner authorized implementation on 2026-09-27. The [runtime contract](../../../../specs/background-knowledge-convergence/runtime.md) and [implementation evidence](../../../../evidence/quality/background-knowledge-convergence-implementation.md) record local implementation and a private installed canary. Production fleet activation remains pending. New event contracts require reader-first deployment and a separately reviewed writer transition. Existing services retain their behavior. No project receives implicit document-write delegation, a new provider, or a larger spend allowance.

The design preserves local execution without a Hub, user-owned regions, exact approvals, isolated provider adapters, and the distinction between canonical Markdown and rebuildable projections. It adds automatic continuation and recovery without making background generated prose canonical by itself.

Acceptance must cover idle repositories, concurrent user edits, restart during apply, provider limits, candidate rejection, opaque assets, legacy debt, and one installed no-Hub journey reaching verified currency without another human turn.

## References

- [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)
- [ADR-0433](0433-own-background-knowledge-for-every-repository-change.md)
- [ADR-0195](../0195-reviewed-document-content-normalization.md)
- [ADR-0303](0303-branch-safe-knowledge-reconciliation-and-canonicalization.md)
- [Agent workspace and integration contract](../../../../specifications/execution/agent-workspaces.md)

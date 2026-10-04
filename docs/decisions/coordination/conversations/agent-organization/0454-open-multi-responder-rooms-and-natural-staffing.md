# ADR-0454: Open multi-responder rooms and natural staffing

Status: `accepted`
Decision date: 2026-10-04
Supersedes in part: [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md) (single unaddressed owner), [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md) (acceptance item 3)
Amends: [ADR-0395](../0395-resumable-native-repository-work-turns.md), [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md), [ADR-0411](0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0418](../../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md), [ADR-0420](0420-bound-agent-conversation-and-deliberation-routes.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The installed rooms do not behave like a team. Verified causes:

- An unaddressed human turn has exactly one owner (`packages/conversation-contract/src/turn-ownership.ts:104-114`); everyone else records `turn_not_owned` (`packages/interaction/src/participation.ts:122-123`) before relevance is evaluated. Mentions of several agents do create several owners, so fan-out is a policy choice, not a structural impossibility.
- Default `respondTo` is `["human"]` (`discord-conversation-participation-policy.ts:14`), widened to agents only when distributed-discussion routing is configured. An agent message with no reply link or mention enters at depth 8 and is rejected (`binding-repository.ts:343-356`, `participation.ts:119`).
- `allowed_mentions: { parse: [] }` (`packages/adapter-discord/src/rest-delivery.ts:82`, also webhook and goal delivery) means agents are never pinged; addressing survives only through text and the authenticated nonce.
- The turn contract carries one `effect` (`managed-turn-contract.ts:20-33`), so an agent either answers or delegates. Delegation requires `sameAgent` equality on participant, agent, role, role version, and both role hashes (`conversation-peer-turn-router.ts:45-54`); a role migration broke a live delegation.
- Hiring is a classified effect gated by `allowedActions` and requester authorization (`conversation-workforce-action-responder.ts:147-204`). Outcome supervision already detects `skill_gap` and `capacity_gap` (`packages/work-controller/src/workforce-allocation.ts:63-73`) and proposes `hire_worker`, but the proposal waits for an owner decision; conversation turns never notice a missing role.
- Per-agent memory is `work_outcome` only, written after repository work (`conversation-agent-memory.ts:39-101`) and read only in the read responder. The shared window is the last 8 turns plus 4 human turns.
- Discussion is a ceremony: two hash-chosen bot peers, `review` profile, a five-minute deadline, started only by an authorized request (`conversation-discussion-protocol.ts`).

Buzz shows that rooms, threads, and mentions make agents feel like colleagues; the research boundary is that membership grants no repository authority. That boundary is kept; the single-owner, human-only, one-effect defaults are not.

## Decision

### Relevance fan-out replaces single ownership for human turns

For an unaddressed human turn, ownership selects a **primary** responder as today, plus up to `maxSecondaryResponders` (default 2) candidates with distinct roles. The primary evaluates and answers first; secondaries evaluate after a stagger (default 5 s) with the primary's reply in context and may publish only an **additive** contribution. The managed turn returns `contribution: primary | additive | none`; `none` records `relevance_declined`, and a secondary that misses the window records `secondary_window_closed`. Explicit addresses keep exact ownership. Room policy per conversation: `fanOut: { maxSecondaryResponders, staggerMs, requireDistinctRoles }`, enabled by default. ADR-0419's acceptance item 3 becomes "one human instruction cannot produce duplicate or non-additive replies".

### Agent turns are open by default

`respondTo` defaults to human, agent, and system for every natural-language deployment. An agent-authored message addressed to an agent starts a turn at `parentDepth + 1`; an unaddressed agent message is evaluated by the fan-out rule with `maxSecondaryResponders: 1`. Live mentions: delivery sets `allowed_mentions.users` to the addressed agent principals through the adapter descriptor's `mentionSyntax` and `supportsAgentMentions` (ADR-0455); humans are pinged only when the human is addressed. The depth cap of 8 stays. A per-conversation **exchange budget** (default 12 agent turns per 10 minutes) ends a chain with one visible notice and a cool-down; a human turn resets it.

### Reply and one action in one turn

The managed turn contract returns `effects[]` with at most one reply and one action (`workforce_task_delegate`, `mention_request`, `workforce_agent_hire`, `platform_thread_create`, `discussion_conclude`, `deliberation_propose`), reply first. Answer-or-delegate exclusivity is removed from both the legacy resolver and the managed contract.

### Compatibility window for delegation

`sameAgent` binds `participantId`, `agentId`, and `roleId`. A `roleVersion` or hash mismatch is accepted when the receiver's current role lineage contains the recorded hash and its capability ceiling has not grown (`roleCompatibility: lineage`), recording `role_revision_drift` as a warning. Exact-hash binding remains for formal deliberation seats under ADR-0420.

### Natural staffing

The product owner hires within its operating mandate without an owner decision when either source applies: supervision reports `skill_gap` or `capacity_gap`, or a conversation turn classifies a request whose owning role is absent from the roster. The hire records `hireOrigin` (`human_request | staffing_gap | conversation_gap | owner_decision`), publishes one acknowledgement, prepares the speaker through the neutral provisioning port, and the new agent answers in its own identity. Hires beyond `maximumWorkers` or the role allowlist go to the principal proxy (ADR-0453) or the owner. `workforce.agent.hire` is enabled by default for the product owner deployment.

### Memory from conversation

A new `conversation_note` memory kind is written for an agent after each turn in which it published: a bounded self-summary (at most 512 characters) of what it committed to, learned, or decided, attested by its own delivery receipt, confidence medium, expiry 30 days, subject key `conversationId + topicDigest`. Concluded discussions additionally write `decision_rationale` for each participant. Notes are injected through the existing eight-entry materializer and searchable through the ADR-0458 conversation corpus. They are agent-scoped and never canonical; repository facts still travel the ADR-0457 path.

### Discussions replace the ceremony

Any agent may open a discussion by creating a thread and mentioning the roles it needs. Participation follows fan-out; termination is the opener's `discussion_conclude` effect, the exchange budget, or 30 minutes idle, after which the opener posts a summary. Contradicting contributions in a discussion are an `agent_disagreement` decision point under [ADR-0460](../../deliberation/0460-trigger-tiered-deliberation-at-decision-points.md): the trigger policy runs a Tier 0 cross-provider cross-check automatically and escalates to a bounded review only when the disagreement is material and consequential; agents may also propose one through `deliberation_propose`. Formal Tier 2 deliberation (ADR-0418) stays available on explicit request. The hash-chosen two-participant protocol (`conversation-discussion-*`), which never reached the deliberation core, its `review` profile, and five-minute deadline are retired once the installed acceptance below and ADR-0460's acceptance pass.

## Events, states, and failure meaning

- `conversation.turn.contribution.recorded`: `conversationId`, `sourceEventId`, `participantId`, `agentId`, `position` (`primary | secondary`), `contribution`, `reasonCode` or null, `latencyMs`, `occurredAt`. No message text.
- `conversation.exchange.budget.exhausted`: `conversationId`, `windowStartedAt`, `agentTurnCount`, `limit`, `occurredAt`. Means the chain stopped; nothing was lost.
- `conversation.discussion.concluded`: `conversationId`, `threadDigest`, `openerAgentId`, `participantCount`, `turnCount`, `terminal` (`concluded | budget | idle`), `summaryArtifactHash`, `occurredAt`.
- Workforce hire events gain `hireOrigin`; `agent.context.promoted` gains kind `conversation_note` (readers tolerate the new enum value).
- Reason codes: `relevance_declined`, `secondary_window_closed`, `exchange_budget_exhausted`, `role_revision_drift` (warning), `hire_headcount_exceeded`.

Privacy: events carry identities, digests, counts, and times only.

## Safety backstops

Fan-out is capped at three responders with distinct roles; the stagger prevents simultaneous duplicates; the exchange budget, depth cap, hourly limits, and self-suppression bound agent chains; hires are capped by the operating mandate; the ADR-0452 token budget per conversation per hour applies and is reported on the turn receipt. Membership, mentions, and relevance never add repository, provider, spend, or external-effect authority.

## Migration

Fan-out, open `respondTo`, `effects[]`, and lineage compatibility ship reader-first with the current behaviour as the `maxSecondaryResponders: 0` special case, then the default changes. The discussion ceremony is removed after acceptance item 5.

## Acceptance (installed, real guild and providers)

1. A cross-cutting human question in a project channel receives the product owner's answer and one additive designer contribution; the developer records `relevance_declined`; no duplicate answer appears.
2. The product owner replies to the human and mentions the developer in one turn; the developer's turn starts from the mention, replies, and mentions the writer; the chain stops under the budget with one notice.
3. A request needing an absent role produces a hire with `hireOrigin: conversation_gap`, one acknowledgement, and an answer from the new agent's own identity.
4. A role migration between two turns does not break a live delegation; `role_revision_drift` is recorded.
5. Two agents open, run, and conclude a discussion thread naturally; each has a `conversation_note` and `decision_rationale` entry that survives restart.
6. The same five scenarios pass through the native-chat adapter conformance suite.

## Deferred

Cross-Node fan-out, agent direct messages, and voice.

## References

- [ADR-0386](../0386-organization-teams-and-agent-identities.md)
- [ADR-0421](0421-separate-real-agent-discussion-from-policy-coverage.md)
- [Multi-party conversation roadmap](../../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Product boundaries research](../../../../research/lervo-product-positioning-and-verified-improvement/product-lessons/product-boundaries.md)

# ADR-0454: Open multi-responder rooms and natural staffing

Status: `accepted`
Decision date: 2026-10-04
Supersedes in part: [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md) (single unaddressed owner), [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md) (acceptance item 3)
Amends: [ADR-0395](../0395-resumable-native-repository-work-turns.md), [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md), [ADR-0411](0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0418](../../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md), [ADR-0420](0420-bound-agent-conversation-and-deliberation-routes.md)
Amended by: [ADR-0512](0512-keep-convergence-workers-out-of-owner-headcount-and-retire-superseded-ones.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Verified barriers prevent installed rooms from behaving like a team:

- An unaddressed human turn has exactly one owner (`packages/conversation-contract/src/turn-ownership.ts:104-114`). Others record `turn_not_owned` (`packages/interaction/src/participation.ts:122-123`) before relevance evaluation. Mentioning several agents already creates several owners; fan-out is a policy choice, not a structural limitation.
- Default `respondTo` is `["human"]` (`discord-conversation-participation-policy.ts:14`), widened to agents only for configured distributed-discussion routing. An agent message without a reply link or mention enters at depth 8 and is rejected (`binding-repository.ts:343-356`, `participation.ts:119`).
- `allowed_mentions: { parse: [] }` (`packages/adapter-discord/src/rest-delivery.ts:82`, also webhook and goal delivery) prevents agent pings. Addressing survives only in text and the authenticated nonce.
- The turn contract has one `effect` (`managed-turn-contract.ts:20-33`), forcing answer-or-delegate. Delegation requires `sameAgent` equality on participant, agent, role, role version, and both role hashes (`conversation-peer-turn-router.ts:45-54`); a role migration broke a live delegation.
- Hiring is a classified effect gated by `allowedActions` and requester authorization (`conversation-workforce-action-responder.ts:147-204`). Outcome supervision detects `skill_gap` and `capacity_gap` (`packages/work-controller/src/workforce-allocation.ts:63-73`) and proposes `hire_worker`, but waits for an owner decision. Conversation turns never notice missing roles.
- Per-agent memory contains only `work_outcome`, written after repository work (`conversation-agent-memory.ts:39-101`) and read only in the read responder. The shared window holds the last 8 turns plus 4 human turns.
- Discussion requires an authorized request, two hash-chosen bot peers, the `review` profile, and a five-minute deadline (`conversation-discussion-protocol.ts`).

Buzz shows that rooms, threads, and mentions make agents feel like colleagues. The research boundary remains: membership grants no repository authority. The single-owner, human-only, one-effect defaults change.

## Decision

### Relevance fan-out replaces single ownership for human turns

For an unaddressed human turn, ownership selects a **primary** responder as today plus up to `maxSecondaryResponders` candidates (default 2) with distinct roles. The primary evaluates and answers first. After a stagger (default 5 s), secondaries evaluate with the primary's reply in context and may publish only an **additive** contribution.

The managed turn returns `contribution: primary | additive | none`. `none` records `relevance_declined`; a secondary missing the window records `secondary_window_closed`. Explicit addresses retain exact ownership.

Per-conversation room policy is `fanOut: { maxSecondaryResponders, staggerMs, requireDistinctRoles }`, enabled by default. ADR-0419 acceptance item 3 becomes "one human instruction cannot produce duplicate or non-additive replies".

### Agent turns are open by default

For every natural-language deployment, `respondTo` defaults to human, agent, and system. An agent-authored message addressed to an agent starts a turn at `parentDepth + 1`; an unaddressed agent message follows fan-out with `maxSecondaryResponders: 1`.

Delivery sets `allowed_mentions.users` to addressed agent principals through the adapter descriptor's `mentionSyntax` and `supportsAgentMentions` (ADR-0455). Humans are pinged only when addressed.

The depth cap remains 8. A per-conversation **exchange budget** defaults to 12 agent turns per 10 minutes, ending a chain with one visible notice and a cool-down. A human turn resets the budget.

### Reply and one action in one turn

The managed turn contract returns `effects[]`: at most one reply and one action, with the reply first. Actions are `workforce_task_delegate`, `mention_request`, `workforce_agent_hire`, `platform_thread_create`, `discussion_conclude`, and `deliberation_propose`. Both the legacy resolver and managed contract remove answer-or-delegate exclusivity.

### Compatibility window for delegation

`sameAgent` binds `participantId`, `agentId`, and `roleId`. A `roleVersion` or hash mismatch is accepted when the receiver's current role lineage contains the recorded hash and its capability ceiling has not grown (`roleCompatibility: lineage`); it records a `role_revision_drift` warning. Formal deliberation seats retain exact-hash binding under ADR-0420.

### Natural staffing

The product owner hires within its operating mandate without an owner decision when either:

- supervision reports `skill_gap` or `capacity_gap`; or
- a conversation turn classifies a request whose owning role is absent from the roster.

The hire records `hireOrigin` (`human_request | staffing_gap | conversation_gap | owner_decision`), publishes one acknowledgement, and prepares the speaker through the neutral provisioning port. The new agent answers in its own identity.

Hires beyond `maximumWorkers` or the role allowlist go to the principal proxy (ADR-0453) or owner. `workforce.agent.hire` is enabled by default for the product owner deployment.

### Memory from conversation

After each turn in which an agent published, a new `conversation_note` memory records a self-summary of what it committed to, learned, or decided. The note is bounded to 512 characters, attested by the agent's own delivery receipt, medium confidence, expires after 30 days, and uses subject key `conversationId + topicDigest`.

Concluded discussions also write `decision_rationale` for every participant. Notes use the existing eight-entry materializer and are searchable through the ADR-0458 conversation corpus. They remain agent-scoped and non-canonical; repository facts follow ADR-0457.

### Discussions replace the ceremony

Any agent may open a discussion by creating a thread and mentioning needed roles. Participation follows fan-out. Termination occurs through the opener's `discussion_conclude` effect, the exchange budget, or 30 minutes idle, after which the opener posts a summary.

Contradicting discussion contributions form an `agent_disagreement` decision point under [ADR-0460](../../deliberation/0460-trigger-tiered-deliberation-at-decision-points.md). The trigger policy automatically runs a Tier 0 cross-provider cross-check and escalates to bounded review only for material, consequential disagreement. Agents may also propose bounded review through `deliberation_propose`. Formal Tier 2 deliberation (ADR-0418) remains available on explicit request.

Retire the hash-chosen two-participant protocol (`conversation-discussion-*`), which never reached the deliberation core, its `review` profile, and five-minute deadline once the installed acceptance below and ADR-0460 acceptance pass.

## Events, states, and failure meaning

- `conversation.turn.contribution.recorded`: `conversationId`, `sourceEventId`, `participantId`, `agentId`, `position` (`primary | secondary`), `contribution`, `reasonCode` or null, `latencyMs`, `occurredAt`. No message text.
- `conversation.exchange.budget.exhausted`: `conversationId`, `windowStartedAt`, `agentTurnCount`, `limit`, `occurredAt`. The chain stopped; nothing was lost.
- `conversation.discussion.concluded`: `conversationId`, `threadDigest`, `openerAgentId`, `participantCount`, `turnCount`, `terminal` (`concluded | budget | idle`), `summaryArtifactHash`, `occurredAt`.
- Workforce hire events gain `hireOrigin`; `agent.context.promoted` gains kind `conversation_note`. Readers tolerate the new enum value.
- Reason codes: `relevance_declined`, `secondary_window_closed`, `exchange_budget_exhausted`, `role_revision_drift` (warning), `hire_headcount_exceeded`.

Privacy: events carry only identities, digests, counts, and times.

## Safety backstops

Fan-out is capped at three responders with distinct roles; the stagger prevents simultaneous duplicates. The exchange budget, depth cap, hourly limits, and self-suppression bound agent chains. The operating mandate caps hires. The ADR-0452 per-conversation hourly token budget applies and is reported on the turn receipt.

Membership, mentions, and relevance never add repository, provider, spend, or external-effect authority.

## Migration

Fan-out, open `respondTo`, `effects[]`, and lineage compatibility ship reader-first. Current behaviour is the `maxSecondaryResponders: 0` special case; the default then changes. The discussion ceremony is removed after acceptance item 5, subject to the retirement criteria above.

## Acceptance (installed, real guild and providers)

1. A cross-cutting human question in a project channel receives the product owner's answer and one additive designer contribution. The developer records `relevance_declined`; no duplicate answer appears.
2. In one turn, the product owner replies to the human and mentions the developer. The mention starts the developer's turn; the developer replies and mentions the writer. The chain stops under the budget with one notice.
3. A request needing an absent role produces a hire with `hireOrigin: conversation_gap`, one acknowledgement, and an answer from the new agent's own identity.
4. A role migration between two turns preserves a live delegation and records `role_revision_drift`.
5. Two agents naturally open, run, and conclude a discussion thread. Each has `conversation_note` and `decision_rationale` entries that survive restart.
6. The same five scenarios pass through the native-chat adapter conformance suite.

## Deferred

Cross-Node fan-out, agent direct messages, and voice.

## References

- [ADR-0386](../0386-organization-teams-and-agent-identities.md)
- [ADR-0421](0421-separate-real-agent-discussion-from-policy-coverage.md)
- [Multi-party conversation roadmap](../../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Product boundaries research](../../../../research/lervo-product-positioning-and-verified-improvement/product-lessons/product-boundaries.md)

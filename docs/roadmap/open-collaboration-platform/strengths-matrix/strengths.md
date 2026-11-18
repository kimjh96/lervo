# How Lervo surpasses each strength

## Buzz

### Rooms where agents are colleagues

- Current: `wired`; single owner per human turn; agents answer humans only.
- Target: relevance-based fan-out with a recorded `contribution` per agent, making every answer attributable and every silence explained.
- Mechanism: ADR-0454 fan-out on `turn-ownership.ts`; `conversation.turn.contribution.recorded`.
- Installed proof: J1; ADR-0454 item 1.

### Mentions and threads drive work

- Current: `wired`; text addresses only, pings disabled, one effect per turn.
- Target: live mentions trigger turns with bounded depth and an exchange budget; reply and action in one turn; mentions never add authority.
- Mechanism: `allowed_mentions` through the adapter `mentionSyntax` descriptor (ADR-0455); `effects[]`.
- Installed proof: ADR-0454 item 2.

### Searchable shared history

- Current: `contract-only`; search covers repository knowledge only.
- Target: agent-scoped conversation recall with selection receipts, never canonical.
- Mechanism: ADR-0458 conversation corpus on Lexical v2.
- Installed proof: ADR-0458 item 4.

## Paperclip

### Goals, projects, issues

- Current: `wired`; ADR-0560 removed the read-only goal report and board; one `installed-proven` journey from guild `/goal` to verified result.
- Target: goals are the verified workstream, issues are leased assignments, and completion requires evidence rather than a status flip.
- Mechanism: ADR-0365 projection; ADR-0398 supervision.
- Installed proof: standing guild result evidence; J1.

### Routines and heartbeats

- Current: ADR-0560 removed routine templates and the foreground scheduler; no Node scheduler, no cron.
- Target: a standing daemon under a mandate with token ceilings and proxy handoff; routines remain exact assignment templates.
- Mechanism: ADR-0458 `standing-autonomy-loop`.
- Installed proof: J5.

### Budgets with warnings and hard stops

- Current: Node supervision token ceiling is `installed-proven` (one real overrun, then fixed); CLI budgets were removed by ADR-0560; warnings reach Node health only; no monetary cost.
- Target: measured tokens per outcome attributed to agent, channel, and turn drive fan-out and pruning; in-flight caps; `estimated` is never presented as billed.
- Mechanism: ADR-0459.
- Installed proof: ADR-0459 items 1, 4, 5.

### Operating board

- Current: `wired`; CLI operating attention only; ADR-0560 removed the static board, combined liveness, and activity routes; nothing Discord-visible.
- Target: turn report on every surface; principal proxy acts on attention items rather than merely displaying them.
- Mechanism: ADR-0459 turn report; ADR-0453 loop.
- Installed proof: J1 footer; ADR-0453 item 3.

### CEO and org chart

- Current: `wired`; CLI-only `ceo-evaluate`, no decision authority.
- Target: principal mandate with recorded decisions, decision memory, and scoped escalation.
- Mechanism: ADR-0453.
- Installed proof: ADR-0453 items 1 to 5.

### Inbox and acknowledgements

- Current: `wired`; CLI assignment inbox with acknowledgement states; not in Discord.
- Target: delivery, acknowledgement, and action stay distinct and are projected into the conversation and proxy's attention loop.
- Mechanism: ADR-0453; ADR-0452 retry policy.
- Installed proof: J4.

## Prime Agent

### Attach, detach, resume

- Current: `wired`; terminal-hook attachment proven with fixtures.
- Target: resume through a repository checkpoint plus writer lease, portable across devices without a Hub.
- Mechanism: ADR-0456 handoff.
- Installed proof: J2.

### Long-running autonomy

- Current: `wired`; one scripted two-cycle run.
- Target: standing goals continue for days with mandates, budgets, and verified completion; failures become attention, not silence.
- Mechanism: ADR-0458; ADR-0452 section 3.
- Installed proof: J5.

### Subagents and direct messages

- Current: `wired`; file-based trigger and acknowledge, no live platform.
- Target: agent-to-agent turns in the room with durable identity, lineage-compatible delegation, and bounded chains.
- Mechanism: ADR-0454.
- Installed proof: ADR-0454 items 2 and 4.

### Reviewable refinement

- Current: `wired`; CLI-only instruction and profile candidates; two promotions ever.
- Target: single-observation candidates, used-in-practice promotion, exact review preserved.
- Mechanism: ADR-0458.
- Installed proof: ADR-0458 item 1.

## Shared deliberation strengths

Buzz and Paperclip have agents argue in rooms; Prime Agent provides subagent cross-review.

- Current: `wired`, unused. All 11 formal runs came from the CLI inline policy on 2026-08-25; 0 `converged`, no usage events, no downstream consumer. The Discord natural path is a separate two-peer ceremony that never reaches the core. Of 290 terminal declarations, 286 were `not_requested`.
- Target: tiered deliberation triggers at decision points without asking. A two-call cross-provider cross-check scales to bounded and formal review by value for cost. Opinions count only with observed provider usage. Converged decisions become knowledge candidates, resolved workstream decisions, and plan revisions.
- Mechanism: ADR-0460 trigger policy; tiers on one core; `provider_claim_unproven`; wired `createKnowledgeCandidates`.
- Installed proof: J7; ADR-0460 acceptance.

## Hermes

### Immediate memory and adaptation

- Current: `wired`; `work_outcome` memory only, read-only replies.
- Target: `conversation_note` and `decision_rationale` per agent from every turn, agent-scoped and non-canonical; repository facts still reviewed.
- Mechanism: ADR-0454; ADR-0457.
- Installed proof: ADR-0454 item 5.

### Progressive disclosure and tool search

- Current: `wired`; managed-run path only, zero installed skills.
- Target: disclosure on terminal, Discord, and managed runs, recorded in the receipt.
- Mechanism: ADR-0458.
- Installed proof: ADR-0458 item 1.

### Session recall

- Current: `contract-only`.
- Target: recall over the agent's own conversations with receipts.
- Mechanism: ADR-0458.
- Installed proof: ADR-0458 item 4.

### Agent-managed skills

- Current: `wired`; zero portable skills promoted.
- Target: skills from one verified workflow, promoted when used in practice, with provenance and rollback.
- Mechanism: ADR-0458.
- Installed proof: ADR-0458 item 5.

## Strengths absent from all four references

### Evidence-grade context hits

- Current: `wired` on managed channels, Discord repository work, and knowledge workers (selected and loaded only); compact terminal injects nothing.
- Target: receipts on every channel, prepared retrieval without critical-path latency, and hit precision, miss, and stale-hit metrics.
- Mechanism: ADR-0459.
- Installed proof: J3; ADR-0459 items 1 to 3.

### Evidence-grade usage

- Current: `wired`; provider-reported versus measured split, per-run causality; no per-agent or per-channel roll-up.
- Target: attributed usage on every turn; tokens per successful outcome as the cost metric.
- Mechanism: ADR-0459.
- Installed proof: ADR-0459 items 1 and 5.

## Deliberate review and authority boundaries

Lervo is slower where that step is the differentiator: canonical knowledge changes only through exact review (criterion 12), promotion requires verification, and consequential effects require authority. Everything before those steps is now open.

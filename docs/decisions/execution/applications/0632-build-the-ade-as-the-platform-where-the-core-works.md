# ADR-0632: Build the ADE as the platform where the core works

Status: `accepted`
Decision date: 2026-11-24
Amends: [ADR-0613](0613-host-provider-clis-in-a-first-party-development-environment.md) (S2 is ordered now, and a core capability counts as delivered to the ADE only when a hosted session uses it)
Amended by: [ADR-0633](../providers/hooks/0633-record-a-linked-worktree-in-its-registered-repository.md) (a hosted session in a workspace worktree records into its registered repository), [ADR-0637](0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md) (orders the S2 steps after the day of use, and keeps one writer per worktree when several agents share a workspace), [ADR-0642](0642-improve-the-ade-in-daily-use.md) (the day of use becomes daily use)
Related: [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0455](0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md), [ADR-0562](../../foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md), [ADR-0563](../../foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md)

## Context

The [core outcomes](../../../product/vision/core-outcomes.md) took their strengths from four products: Hermes (immediate memory, progressive disclosure, conversation recall), Prime Agent (long-running work and subagents with durable identity), Buzz (threads, mentions, an inbox, and agent-to-agent turns), and Paperclip (an operating view, budgets, and caps). ADR-0613 made the Lervo ADE the first-party product that "uses the same core and goes further", and left S2 to be defined when S1 completes.

On 2026-11-24 the owner said two things:

- The ADE becomes the owner's own platform, combining the strengths of those four products, so its foundation must be built for that.
- Core work must be fully usable in the ADE. It need not show in the window, but it must work there; otherwise there is no reason to use the ADE.

That day a hosted session was checked as the ADE runs it: Claude Code in print mode with structured streams, in a Lervo worktree, with the session markers removed. The `UserPromptSubmit` context reached the model, which quoted the "Lervo compact terminal context" block. The context arrives through the project hooks: every registered repository tracks `.claude/settings.json` and `.lervo/generated/terminal-hooks/runtime-v2.mjs`, and ADE worktrees branch from the default branch. The hosted launch itself passes only the `SessionStart` and `SessionEnd` recording hooks. A worktree without project hooks would run a plain provider session.

## Decision

### A capability reaches the ADE when a hosted session uses it

A core capability counts as delivered to the ADE when a hosted session uses it, checked in a hosted session the way the ADE launches one. Showing it in the window is optional. Each core-loop item names its ADE delivery in its definition of done, in one of two forms:

- the hook and context path, checked in a hosted session; or
- an application command or event that the session host or the interface calls.

### Six foundations

1. **Every hosted session is a Lervo session.** It gets Lervo's context, Stop check, capture, and evidence hooks in every repository. Project hooks carry them today. The hosted launch adds the terminal hooks only for a worktree whose project settings lack them. The provider's session ID keys the context epochs, so one session never receives the same block twice. Lervo's tools join through the MCP server in S2.
2. **A session belongs to an agent, and a workspace holds agents.** Each hosted session carries a Lervo agent identity from the agent registry: its role, ancestry, and lease. A workspace runs one agent today. New launch records, protocol messages, and session-host state key sessions by agent, never by assuming one session per workspace, so subagents, reviewers, and rooms add sessions without a migration.
3. **Usage is observed, not estimated.** The session host reads each turn's usage from the structured stream: tokens, and cost when the provider reports it. It reports the usage to the core per session. Budgets, warnings, in-flight caps, and the operating view read those records, and a number that is estimated says so. Hosted usage is recorded in `resource.usage.recorded`, the event managed work already uses, with a hosted session as its attribution instead of a work. Lervo therefore keeps one usage ledger with one token vocabulary. Mandate and agent budgets keep reading managed records only, because the owner's own turns are not agent spend.
4. **Work continues without a window.** Sessions already outlive the window. Long-running work (goals, heartbeats, and bounded continuation over the workstream) runs in the core and the session host within budgets and loop guards. After a host restart it resumes through the provider's resume.
5. **Agents talk through the core.** Agent-to-agent turns, threads, mentions, and the inbox go through Lervo's identity, assignment, and handoff records. Delivery, acknowledgment, action, and verified result stay distinct. Provider processes never message each other directly, and joining a room grants no repository authority.
6. **No capability lives only in the ADE.** Each capability lives in the core behind a hook or an application command, and it works from the terminal too ([ADR-0455](0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md)). The ADE still owns no authority (ADR-0613).

### S2 order

S2 is ordered now, not after S1 completes, because the core work it carries lands now:

1. **S2a, Lervo sessions everywhere.** The hosted launch adds the terminal hooks where project settings lack them. Each core release that changes the hook or context path, such as the context assembler's `SessionStart` block, is checked in a hosted session.
2. **S2b, usage records.** The session host reports each turn's usage, and the core records it per session.
3. **S2c, agent identity.** Hosted launches carry an agent identity, and session-host state keys sessions by agent.
4. **S2d, Lervo tools.** The Lervo MCP server reaches hosted sessions, with memory capture, recall, and messaging through the core.
5. **S2e, hosted observations.** `tool_observed` and `instructions_loaded`, as ADR-0613 defines.

Continuation, rooms and the inbox, and the operating view follow. Each lands in the core first and reaches the ADE by the rule above.

## State, events, privacy, and failure meaning

Each S2 increment defines its new events and states, with required fields, privacy handling, and failure meaning, in [Lervo ADE sessions](../../../specifications/execution/product-surfaces/ade-sessions.md) before it ships. Usage records hold counts and amounts, never message text. A turn without reported usage records nothing; it never records a zero.

## Consequences

- Core work is not done when it works only from the terminal. Each core-loop item now carries a hosted-session check or an application command.
- The session host and the protocol stop assuming one session per workspace in new code.
- The owner's platform grows in the core first, so the terminal and any later surface keep the same capabilities.

## Verification

- **The rule.** For each core release that changes the hook or context path, a hosted session in a registered repository shows the change: the model receives the block, or the Stop check acts.
- **S2a.** A hosted session in a worktree without project hooks receives the Lervo context, and a worktree with them receives each block once.
- **S2b.** Usage records for a session sum to the totals the provider reported for it.
- **S2c.** Two hosted sessions with different agents run in one workspace, and each keeps its own identity and lease.

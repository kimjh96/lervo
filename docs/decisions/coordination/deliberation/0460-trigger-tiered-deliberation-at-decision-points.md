# ADR-0460: Trigger tiered deliberation at decision points on every channel

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0019](0019-provider-neutral-deliberation.md), [ADR-0133](0133-cli-two-provider-deliberation.md), [ADR-0418](../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md), [ADR-0415](../conversations/0415-natural-deliberation-and-consistent-failure-evidence.md), [ADR-0454](../conversations/agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Deliberation is a distinctive but practically unused Lervo capability. The Mac event store (`.lervo/data/events.sqlite`, 15,631 events through 2026-10-04) shows:

- 11 `deliberation.started` and 11 `deliberation.completed` events, all within 3.5 hours on 2026-08-25, using CLI inline policy `deliberation_cli.two-provider-v1` (Codex proposer, Claude reviewer): 8 `failed` (`provider_turn_failed`, `artifact_publication_failed`, `context_evidence_invalid`), 3 `no_consensus`, 0 `converged`, and 0 decision artifacts. No `resource.usage.recorded` event has scope `deliberation`. Later events reference no `dlb_` identifier except four Codex terminal declarations restating `no_consensus`. There are 1,208 `terminal.turn.observed` events.
- 286 of 290 `terminal.turn.declared` events have `deliberationDisposition: not_requested`. The only authored policy, `.lervo/deliberations/deliberation_architecture-review.yaml` (five seats, two rounds, 24 to 32 provider calls, 500,000 tokens, 30 minutes, full `repository.default.v4` suite), has never run. No evidence document records deliberation on the installed guild.
- The 2026-10-01 reply claiming "separate Sol and Opus opinions" was ordinary conversation. Its evidence, `docs/evidence/quality/background-knowledge-convergence-implementation/installed-2026-10-01/discord.md:19-21`, records only Claude Opus usage: prose claimed two providers; usage proved one.

Source inspection identifies six causes:

1. **Explicit human requests are the only trigger.** The product-surface spec and ADR-0418 require explicit challenge requests; recommendation grants no start authority. `apps/cli/src/managed-run.ts`, `supervised-run-command.ts`, `apps/node-runtime/src/supervision-*.ts`, and `packages/work-controller/src` contain no deliberation trigger. `deliberation.convene` is only a permission string (`ceo-policy.ts:21`).
2. **Terminal agents have neither trigger nor cue.** `terminal.deliberate` in `terminal-request-grounding.ts:44-50` is dead code; both context modes hard-code `workflowId: null`. `terminal-compact-context.ts` never mentions deliberation. The only prompt text is the after-the-fact `deliberationDisposition` field (`terminal-prompt-context.ts:307`).
3. **The cheapest path is expensive.** Inline mode defaults to 12 calls, 200,000 tokens, 300 seconds, and always two rounds (`deliberation-roles.ts:37-41,222`); the authored policy needs 20 to 32 calls. Convergence requires configured verification suites to pass (`deliberation-rounds.ts:88-147`), making design questions pay for repository verification.
4. **Discord's natural path bypasses the core.** `ConversationDeliberationActionResponder` exists but is unwired. Composition instead wires `conversation-discussion-action-responder.ts` for `deliberation_start` (`discord-conversation-response-composition.ts:138,243-246`). This protocol uses two hash-chosen bot peers and a five-minute deadline, with no rounds, budget, verification, `@lervo/deliberation*` imports, or `deliberation.*` events. It replaced ADR-0415's default-policy natural start with a Discord-only ceremony.
5. **Results do not change work.** `createKnowledgeCandidates` (`packages/knowledge/src/create-candidates.ts:20`) is the only code converting `converged` outcomes into candidates, and only tests call it. No workstream update, assignment, plan revision, or memory consumes outcomes; consumers are projections and the declaration check. A `converged` decision produces only a reply and records.
6. **Opinions lack provider proof.** Budget observation requires a token total per run, but `observedRunTokens` (`managed-deliberation-budget.ts:12-21`) takes the maximum `totalTokens` across usage events regardless of `status` or `scope`. The discussion path has no usage gate, and a single-provider reply can claim two providers' opinions.

Buzz and Paperclip offer agents arguing in rooms; Prime Agent offers subagent cross-review; Hermes offers none. None binds opinions to observed provider usage, scores disagreement, or turns decisions into canonical records. Lervo can differentiate here only if deliberation runs.

## Decision

### Three tiers of one core

All tiers use `@lervo/deliberation` and `@lervo/deliberation-runtime`, sharing artifact kinds, events, usage scope, and a host-neutral port. Policies gain `tier`.

| Tier | Shape | Bounds | Verification | Output |
| --- | --- | --- | --- | --- |
| 0 `cross_check` | Two independent opinions from two providers on one question; deterministic disagreement comparison of structured claims | 2 calls, 24,000 tokens, 90 s | none | `agreement` or `material_disagreement`, with contested claims |
| 1 `bounded_review` | Proposer, one reviewer from the other provider, verifier; one round | 6 calls, 120,000 tokens, 10 min | configured suite, run once | `converged`, `no_consensus`, `failed` |
| 2 `formal` | Existing stored policy (ADR-0418) | policy budget | policy suites | unchanged |

Tier 0 and 1 definitions are built in as `deliberation_tier0.cross-check-v1` and `deliberation_tier1.bounded-review-v1`. Inline `two-provider-v1` becomes the Tier 1 definition. Tier 0 detects disagreement cheaply and never claims convergence.

### Decision points and the value-for-cost policy

A pure `deliberation-trigger-policy` in `packages/work-controller` maps `DecisionPointSignal` to a tier or `none`. Signals contain:

- `kind`: `adr_authoring`, `core_change`, `design_fork`, `agent_disagreement`, `repeated_verification_failure`, `principal_decision`, or `explicit_request`.
- `riskClass`, `reversibility`, and `novelty` (no canonical document hit for the question in the ADR-0459 receipt).
- `disagreement` (contradicting contributions under ADR-0454 fan-out) and `consequenceClasses` (ADR-0453).

Default decisions:

| Decision point | Tier |
| --- | --- |
| New or changed file under `docs/decisions` | 0 |
| Change touching `packages/schemas` or more than eight files in core packages | 0 |
| Managed turn returns two or more alternatives | 0; escalate to 1 on `material_disagreement` |
| Same verification failure code twice | 1 |
| Contradicting room contributions | 0 |
| Principal-proxy settlement with consequence class `repository_write` | 0 |
| Explicit human request | 2 |

Any agent may propose via managed turn effect `deliberation_propose { tier, question }`. The policy decides, not the proposer; proposals never bypass budget.

### Triggers on every channel, none on the critical path

- **Terminal (Claude Code, Codex):** On `Stop`, a deterministic decision-point detector uses changed paths, makes no provider call, and stays within the ADR-0451 budget. It enqueues a Tier 0 job for the knowledge resident. The next prompt receives one compact-context line, such as "Cross-check on ADR-0460: Codex and Claude agree" or "disagree on claim 2 — run `lervo deliberate --resume <id>` for Tier 1". Remove the dead `terminal.deliberate` workflow.
- **Managed and supervised runs:** `managed-run.ts` and `supervision-native-plans` evaluate the policy after verification and after plan construction. Tier 0 or 1 results become required context documents for the next turn and are recorded in its receipt.
- **Rooms:** Replace natural `deliberation_start` with `deliberation_propose`; retain the formal Tier 2 slash command. Retire `conversation-discussion-*`. Natural discussion follows ADR-0454 conversation; decision-grade disagreement escalates here.
- **Principal proxy:** ADR-0453 settlements evaluate the policy before settling.

### Outputs that change the work

On Tier 1 or 2 `converged`, the runtime performs these effects in the same transaction as `deliberation.completed`:

- Create a knowledge candidate of kind `decision` through `createKnowledgeCandidates` and the ADR-0457 source kind, now named `decision` with `source: deliberation | conversation`.
- If the question was a pending decision, record `workstream.decision.resolved` with `resolverKind: deliberation`.
- On a blocking objection, mark the affected supervision plan `revision_required`.
- Write `decision_rationale` memory for every participant agent and the proxy, amending ADR-0411.

Tier 0 `material_disagreement` on a consequential class escalates to Tier 1. Unresolved `no_consensus` on a consequential class creates one ADR-0453 escalation item. Everything else is recorded and shown in the turn report, never pushed to the owner.

### Provider-proven opinions

An artifact is `verified` only if a `resource.usage.recorded` event exists with scope `deliberation`, status `complete`, and the artifact's run and provider. Correct `observedRunTokens` accordingly. `unverified` artifacts count toward neither agreement nor convergence.

Add writing-contract check `provider_claim_unproven`: a reply naming more than one provider's opinion must cite a `dlb_` identifier whose participants' usage is verified. Otherwise publication fails and the reply is repaired to describe one provider.

### Measurement

Under ADR-0459:

- `deliberation.trigger.evaluated` records every decision point and chosen tier, yielding deliberation rates per decision-point kind.
- Usage per tier measures cost.
- `outcomeChangeRate` is the share of `converged` results producing a candidate, plan revision, or resolved decision.
- `laterDefectRate` compares verification failures within seven days on paths touched by a decision, with and without deliberation.
- `disagreementRate` is measured per provider pair.

The operating mandate sets a per-repository daily deliberation token ceiling. Tier 0 needs no approval; Tier 1 needs an active mandate; autonomous Tier 2 requires `decisionKinds: deliberation_formal` in a principal mandate.

## Events, states, and failure meaning

- `deliberation.trigger.evaluated`: `signalKind`, `sourceEventId`, `channel`, `score`, `tier` or `none`, `reasonCodes`, `proposerAgentId` or null, `occurredAt`.
- `deliberation.started` and `.completed` gain `tier` and `triggerEventId`. `completed` also gains `effects[]` (`knowledge_candidate | decision_resolved | plan_revision_required | memory_promoted | escalated | none`) and `verifiedParticipantCount`.
- `deliberation.artifact.recorded` gains `usageVerification: verified | unverified`.
- `deliberation_tier_budget_exhausted`: stop all further execution and record the result so far.
- `deliberation_participant_unverified`: exclude the artifact.
- `provider_claim_unproven`: repair or refuse publication.

Privacy: questions and claims remain in CAS artifacts under existing deliberation privacy. Events carry identifiers, scores, counts, and codes.

## Migration

1. Fix usage verification and add `provider_claim_unproven`; compliant replies retain their behavior.
2. Add tiers and built-in definitions; convert inline mode to Tier 1.
3. Enable Tier 0 on `adr_authoring` for the Lervo repository through the terminal resident; observe for two weeks.
4. Wire candidate, decision, plan-revision, and memory outputs, plus managed-run and supervision triggers.
5. Replace room `deliberation_start`; retire `conversation-discussion-*` after ADR-0454 item 5 and the acceptance criteria below pass.

## Acceptance (installed, real providers and guild)

- Journey J7: during J1, a managed turn returns two alternatives. Tier 0 runs automatically with verified Codex and Claude usage; disagreement escalates to Tier 1. The converged decision appears in the thread, becomes a knowledge candidate and resolved workstream decision, and has a result footer showing per-provider tokens. The owner receives nothing.
- Authoring an ADR in Claude Code produces a Tier 0 line in the next compact prompt within one prompt cycle, with no added prompt latency.
- Ordinary room chatter and status reports evaluate to `none`. Replies claiming two providers' opinions without verified usage are repaired. Tier 1 budget exhaustion records the partial result and permits no further execution.
- Over two weeks, 100 percent of `adr_authoring` points receive Tier 0, and Tier 1 and 2 `outcomeChangeRate` is above zero.

## Deferred

More than two providers per tier, human voting seats, monetary cost, and cross-repository deliberation.

## References

- [ADR-0029 cross-provider runtime](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [ADR-0392 installed deliberation](../conversations/0392-installed-proactive-signals-and-deliberation.md)
- [Deliberation product integration](../../../specifications/execution/product-surfaces/deliberation.md)
- [Collaboration and mentions research](../../../research/paperclip-lervo-collaboration-and-mentions.md)
- [Open collaboration platform roadmap](../../../roadmap/open-collaboration-platform.md)

# ADR-0460: Trigger tiered deliberation at decision points on every channel

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0019](0019-provider-neutral-deliberation.md), [ADR-0133](0133-cli-two-provider-deliberation.md), [ADR-0418](../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md), [ADR-0415](../conversations/0415-natural-deliberation-and-consistent-failure-evidence.md), [ADR-0454](../conversations/agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Deliberation is Lervo's most distinctive multi-agent capability and it is practically unused. Verified on the Mac event store (`.lervo/data/events.sqlite`, 15,631 events to 2026-10-04):

- 11 `deliberation.started` and 11 `deliberation.completed` events exist, all on 2026-08-25 within 3.5 hours, all from the CLI inline policy `deliberation_cli.two-provider-v1` (Codex proposer, Claude reviewer): 8 `failed` (`provider_turn_failed`, `artifact_publication_failed`, `context_evidence_invalid`), 3 `no_consensus`, 0 `converged`, 0 decision artifacts. No `resource.usage.recorded` event has scope `deliberation`. No later event references any `dlb_` identifier except four Codex terminal declarations restating `no_consensus`. Against this stand 1,208 `terminal.turn.observed` events.
- 286 of 290 `terminal.turn.declared` events carry `deliberationDisposition: not_requested`. The only authored policy, `.lervo/deliberations/deliberation_architecture-review.yaml` (five seats, two rounds, 24 to 32 provider calls, 500,000 tokens, 30 minutes, full `repository.default.v4` suite), has never been executed. No evidence document records a deliberation on the installed guild.
- The 2026-10-01 reply that described "separate Sol and Opus opinions" was ordinary conversation; its own evidence (`docs/evidence/quality/background-knowledge-convergence-implementation/installed-2026-10-01/discord.md:19-21`) records only Claude Opus usage. Prose claimed two providers; usage proved one.

Why, verified in source:

1. **Only an explicit human request starts it.** The product-surface spec and ADR-0418 require explicit challenge requests; recommendation grants no start authority. `apps/cli/src/managed-run.ts`, `supervised-run-command.ts`, `apps/node-runtime/src/supervision-*.ts`, and `packages/work-controller/src` contain no deliberation trigger. `deliberation.convene` is only a permission string (`ceo-policy.ts:21`).
2. **Terminal agents have no trigger and no cue.** The `terminal.deliberate` workflow in `terminal-request-grounding.ts:44-50` is dead code; both context modes hard-code `workflowId: null`. `terminal-compact-context.ts` never mentions deliberation; the only prompt text is the after-the-fact `deliberationDisposition` field (`terminal-prompt-context.ts:307`).
3. **The cheapest path is expensive.** Inline mode defaults to 12 calls, 200,000 tokens, 300 seconds, always two rounds (`deliberation-roles.ts:37-41,222`); the authored policy needs 20 to 32 calls. Convergence additionally requires the configured verification suites to pass (`deliberation-rounds.ts:88-147`), so a design question pays for a repository verification run.
4. **The Discord natural path never reaches the core.** `ConversationDeliberationActionResponder` is built but unwired; composition wires `conversation-discussion-action-responder.ts` for the same `deliberation_start` effect (`discord-conversation-response-composition.ts:138,243-246`). That protocol has two hash-chosen bot peers, a five-minute deadline, no rounds, no budget, no verification, imports nothing from `@lervo/deliberation*`, and emits no `deliberation.*` events. ADR-0415's default-policy natural start was therefore replaced by a Discord-only ceremony.
5. **Results change nothing.** `createKnowledgeCandidates` (`packages/knowledge/src/create-candidates.ts:20`) is the only code that turns a `converged` outcome into a candidate, and only tests call it. No workstream update, assignment, plan revision, or memory consumes an outcome; consumers are projections and the declaration check. A `converged` decision is a reply plus records.
6. **Opinions are not provider-proven.** Budget observation requires a token total per run, but `observedRunTokens` (`managed-deliberation-budget.ts:12-21`) takes the maximum `totalTokens` across usage events regardless of `status` or `scope`; the discussion path has no usage gate; nothing stops a single-provider reply from claiming two providers' opinions.

Buzz and Paperclip offer agents who argue in rooms; Prime Agent offers subagent cross-review; Hermes offers none. None binds opinions to observed provider usage, scores disagreement, or turns a decision into a canonical record. That is where Lervo can be better, if deliberation actually runs.

## Decision

### Three tiers of one core

Every tier runs `@lervo/deliberation` and `@lervo/deliberation-runtime` with the same artifact kinds, events, usage scope, and host-neutral port. A policy gains `tier`:

| Tier               | Shape                                                                                                                              | Bounds                          | Verification               | Output                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| 0 `cross_check`    | Two independent opinions from two providers on one question, then a deterministic disagreement comparison on the structured claims | 2 calls, 24,000 tokens, 90 s    | none                       | `agreement` or `material_disagreement` with the contested claims |
| 1 `bounded_review` | Proposer, one reviewer (other provider), verifier; one round                                                                       | 6 calls, 120,000 tokens, 10 min | configured suite, run once | `converged`, `no_consensus`, `failed`                            |
| 2 `formal`         | Existing stored policy (ADR-0418)                                                                                                  | policy budget                   | policy suites              | as today                                                         |

Tier 0 and 1 definitions are built in (`deliberation_tier0.cross-check-v1`, `deliberation_tier1.bounded-review-v1`); the inline `two-provider-v1` becomes the Tier 1 definition. Tier 0 never claims convergence; it exists to detect disagreement cheaply.

### Decision points and the value-for-cost policy

A pure `deliberation-trigger-policy` in `packages/work-controller` maps a `DecisionPointSignal` to a tier or `none`. Signal fields: `kind` (`adr_authoring`, `core_change`, `design_fork`, `agent_disagreement`, `repeated_verification_failure`, `principal_decision`, `explicit_request`), `riskClass`, `reversibility`, `novelty` (no canonical document hit for the question in the ADR-0459 receipt), `disagreement` (contradicting contributions under ADR-0454 fan-out), and `consequenceClasses` (ADR-0453). Defaults: a new or changed file under `docs/decisions` → Tier 0; a change touching `packages/schemas` or more than eight files in core packages → Tier 0; a managed turn that returns two or more alternatives → Tier 0, escalating to Tier 1 on `material_disagreement`; the same verification failure code twice → Tier 1; contradicting room contributions → Tier 0; a principal-proxy settlement whose consequence class is `repository_write` → Tier 0; an explicit human request → Tier 2. Any agent may propose through the managed turn effect `deliberation_propose { tier, question }`; the policy, not the proposer, decides, and a proposal never bypasses budget.

### Triggers on every channel, none on the critical path

- **Terminal (Claude Code, Codex).** On `Stop`, the deterministic decision-point detector (changed paths, no provider call, under the ADR-0451 budget) enqueues a Tier 0 job for the knowledge resident. The result arrives as one compact-context line on the next prompt: "Cross-check on ADR-0460: Codex and Claude agree" or "disagree on claim 2 — run `lervo deliberate --resume <id>` for Tier 1". The dead `terminal.deliberate` workflow is removed.
- **Managed and supervised runs.** `managed-run.ts` and `supervision-native-plans` evaluate the policy after verification and after plan construction; a Tier 0 or 1 result is a required context document of the next turn, recorded in the receipt.
- **Rooms.** The natural `deliberation_start` effect is replaced by `deliberation_propose`; the formal Tier 2 slash command stays. The `conversation-discussion-*` protocol is retired; natural discussion is ADR-0454 conversation, and decision-grade disagreement escalates here.
- **Principal proxy.** ADR-0453 settlements evaluate the policy before settling.

### Outputs that change the work

On `converged` (Tier 1 or 2) the runtime, in the same transaction as `deliberation.completed`: creates a knowledge candidate of kind `decision` through `createKnowledgeCandidates` and the ADR-0457 source kind, now named `decision` with `source: deliberation | conversation`; records `workstream.decision.resolved` with `resolverKind: deliberation` when the question was a pending decision; marks the affected supervision plan `revision_required` on a blocking objection; and writes `decision_rationale` memory for each participant agent and the proxy (ADR-0411 amended). A Tier 0 `material_disagreement` on a consequential class escalates to Tier 1; an unresolved `no_consensus` on a consequential class produces one ADR-0453 escalation item; everything else is recorded and shown in the turn report, never pushed to the owner.

### Provider-proven opinions

An artifact is `verified` only when a `resource.usage.recorded` event with scope `deliberation`, status `complete`, and the artifact's run and provider exists; `observedRunTokens` is corrected accordingly. `unverified` artifacts count toward neither agreement nor convergence. The writing contract gains check `provider_claim_unproven`: a reply naming more than one provider's opinion must cite a `dlb_` identifier whose participants' usage is verified, or it fails publication and is repaired to describe one provider.

### Measurement

Under ADR-0459: `deliberation.trigger.evaluated` records every decision point and the chosen tier, giving the deliberation rate per decision-point kind; usage per tier gives cost; `outcomeChangeRate` is the share of `converged` results that produced a candidate, plan revision, or resolved decision; `laterDefectRate` compares verification failures within seven days on paths a decision touched, with and without deliberation; `disagreementRate` is per provider pair. A per-repository daily deliberation token ceiling lives in the operating mandate; Tier 0 needs no approval, Tier 1 needs an active mandate, and autonomous Tier 2 requires `decisionKinds: deliberation_formal` in a principal mandate.

## Events, states, and failure meaning

- `deliberation.trigger.evaluated`: `signalKind`, `sourceEventId`, `channel`, `score`, `tier` or `none`, `reasonCodes`, `proposerAgentId` or null, `occurredAt`.
- `deliberation.started` and `.completed` gain `tier` and `triggerEventId`; `completed` gains `effects[]` (`knowledge_candidate | decision_resolved | plan_revision_required | memory_promoted | escalated | none`) and `verifiedParticipantCount`.
- `deliberation.artifact.recorded` gains `usageVerification: verified | unverified`.
- Failure codes: `deliberation_tier_budget_exhausted` (nothing further runs; the result so far is recorded), `deliberation_participant_unverified` (artifact excluded), `provider_claim_unproven` (publication repaired or refused).

Privacy: the question and claims live in CAS artifacts under existing deliberation privacy; events carry identifiers, scores, counts, and codes.

## Migration

1. Fix usage verification and add `provider_claim_unproven`; no behaviour change for compliant replies.
2. Add tiers and built-in definitions; convert the inline mode to Tier 1.
3. Enable Tier 0 on `adr_authoring` for the Lervo repository through the terminal resident; observe for two weeks.
4. Wire outputs (candidate, decision, plan revision, memory) and the managed-run and supervision triggers.
5. Replace the room `deliberation_start` path, retire `conversation-discussion-*` after ADR-0454 item 5 and the acceptance below pass.

## Acceptance (installed, real providers and guild)

- Journey J7: during J1 a managed turn returns two alternatives; Tier 0 runs automatically with verified Codex and Claude usage; disagreement escalates to Tier 1; the converged decision appears in the thread, becomes a knowledge candidate and a resolved workstream decision, and the result footer shows per-provider tokens; the owner receives nothing.
- Authoring an ADR in Claude Code yields a Tier 0 line in the next compact prompt within one prompt cycle and no added prompt latency.
- Negative: ordinary room chatter and status reports evaluate to `none`; a reply claiming two providers' opinions without verified usage is repaired; a Tier 1 that exhausts its budget records the partial result and nothing else runs.
- Over two weeks, the deliberation rate per `adr_authoring` point is 100 percent at Tier 0, and `outcomeChangeRate` for Tier 1 and 2 is above zero.

## Deferred

More than two providers per tier, human voting seats, monetary cost, and cross-repository deliberation.

## References

- [ADR-0029 cross-provider runtime](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [ADR-0392 installed deliberation](../conversations/0392-installed-proactive-signals-and-deliberation.md)
- [Deliberation product integration](../../../specifications/execution/product-surfaces/deliberation.md)
- [Collaboration and mentions research](../../../research/paperclip-lervo-collaboration-and-mentions.md)
- [Open collaboration platform roadmap](../../../roadmap/open-collaboration-platform.md)

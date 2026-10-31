# ADR-0458: Learn from single observations and run standing autonomy

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0220](../../../knowledge/repository/0220-evidence-bound-development-pattern-promotion.md), [ADR-0345](0345-observe-reviewed-improvement-effects-without-self-learning-claims.md), [ADR-0365](../governed-work/0365-project-workstream-goals-over-the-assignment-dag.md), [ADR-0411](../../../coordination/conversations/agent-organization/0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0417](../../applications/0417-own-discord-visible-reference-product.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Hermes and Prime Agent lessons became contracts and CLI routes, then were gated until almost nothing learns or runs independently. Verified status (details in the [strengths matrix](../../../../roadmap/open-collaboration-platform/strengths-matrix.md)):

- Attach, detach, and resume are terminal-hook behaviours (`apps/cli/src/terminal-workspace-attachment.ts`), proven with a temporary consumer and Codex and Claude stream fixtures. Goals are the read-only `lervo loop goal`. Discord `/goal` intake exists and is installed-proven, but result supervision remains `delivery required`.
- Heartbeat is `lervo agent heartbeat --write`; `apps/node-runtime/src` has no heartbeat. Bounded autonomy is one foreground `lervo loop schedule` run with a fixture provider; no daemon exists. Direct agent messages use file-based `lervo assignment trigger|acknowledge`, with no live platform.
- Instruction and profile candidates are CLI-only (`knowledge instruction intake|review`, `role candidate ...`); `apps/node-runtime/src` has zero references. Progressive capability disclosure runs only on the managed-run path (`apps/cli/src/run-capabilities.ts`); terminal hooks and Discord never call it. Zero skills are installed in this repository.
- Pattern promotion requires at least two independently grouped verified source units (ADR-0220; `development-pattern-candidate.ts:141,157`) plus an end-of-turn self-declaration. Only two `repository_instruction` patterns and zero portable skills have been promoted.
- Agent memory is `work_outcome` after repository work, injected only in read-only replies. Search source kinds are `document | skill | verified_knowledge`; no conversation or session corpus exists.
- Roadmap entries for all these capabilities say `implemented` on fixture or temporary-consumer evidence.

Hermes adapts quickly by remembering immediately; Prime Agent keeps working through a long-running harness. Lervo reduced these to near-zero learning and one authorized loop run. Exact provenance, verification-bound promotion, and post-promotion measurement justify a slower path, but do not require two independent groups before a candidate can exist.

## Decision

### Single observation to candidate to used-in-practice promotion

Lower learning entry requirements while retaining canonical rigour through three stages:

1. **Observe (open).** Any surface may record `learning.observation.recorded` from one verified turn: a repeated command sequence, user correction, durably phrased instruction, role activation that passed verification, or skill-shaped workflow. Observations are agent-scoped projections, not knowledge.
2. **Candidate (open, reviewable).** One observation with a verified outcome creates a `repository_instruction`, `portable_skill`, `agent_profile`, or `working_preference` candidate with status `candidate_from_single_observation`. Progressive disclosure offers it in context on the next relevant turn, marked unreviewed. Retire ADR-0220's two-group rule as an entry condition.
3. **Promote (exact review).** Promotion requires either the existing exact review or **used-in-practice** evidence: the candidate was selected, loaded, injected, and referenced (ADR-0459 receipt) in at least three later turns with verified passing outcomes and no correction event. Used-in-practice promotion still runs exact-hash review; its evidence replaces the two-group precondition, not review. Canonical materialization retains ADR-0457's lifecycle.

### Progressive disclosure on every channel

Move capability recommendation (`run-capabilities.ts`) into `packages/repository-context` as `prepareCapabilityDisclosure`. Call it from the managed turn, compact terminal prompt, and Discord turns. The compact prompt is limited to a two-line pointer naming at most three candidates, with no provider call. Disclosure records `selected` in the receipt; activation remains provider-confirmed.

### Standing autonomy daemon

A platform-neutral `standing-autonomy-loop` in the Node composition owns heartbeat and continuation. It renews `agent.liveness.observed` for every active agent on an interval, wakes standing goals (ADR-0398) whose next action is due, and runs bounded continuation cycles under the operating mandate's token and attempt ceilings and ADR-0459's in-flight cap.

The loop composes with the principal-proxy loop (ADR-0453): a blocked cycle needing a decision hands it to the proxy instead of stopping. `lervo loop schedule` becomes a foreground view of the same loop. The daemon has a kill switch and an error budget (ADR-0452 section 2), and never starts a provider turn without an admitted mandate.

### Discord wiring of the self-improvement loop

Instruction intake, role-candidate proposal and review, and portable-skill candidate review become typed application commands reachable from Discord through natural language: "make that a rule", "promote that", and "review the skill candidate". The CLI uses the same commands. Review remains exact; the surface only carries the request.

### Recall over conversations

Add a `conversation` corpus to unified search beside repository knowledge: each agent's own inbound and outbound messages, `conversation_note` and `decision_rationale` memories, and discussion summaries. Lexical v2 indexes it under ADR-0413's revision-bound reuse rule; the conversation revision is the outbox head.

Recall is agent-scoped by default; a human query over a channel sees that channel's messages. Results are selection evidence, never canonical, and carry the ADR-0459 receipt.

### Relabeling

Relabel the following roadmap entries `wired` under ADR-0452 section 5, retaining each evidence link: portable continuation, goal lifecycle, runtime liveness, autonomous continuation, agent communication, portable-skill candidates, durable-instruction intake, agent-profile candidates, bounded work graph, worker contracts, retrieval and capability discovery, reusable patterns, continuation, triggers, Slack, execution graphs, and separately installed hosts.

## Events, states, and failure meaning

- `learning.observation.recorded`: `observationId`, `agentId`, `surface` (`terminal | managed_run | conversation | supervision`), `kind`, `sourceEventId`, `verificationStatus`, `occurredAt`. No prompt or output text.
- Candidate events gain `origin: single_observation | grouped_evidence` and status `candidate_from_single_observation`. `learning.candidate.used_in_practice` records `candidateId`, `turnEventId`, `receiptId`, `verificationStatus`, `occurredAt`. Promotion events gain `promotionBasis: exact_review | used_in_practice`.
- `agent.liveness.observed` gains `source: daemon | manual | terminal_hook`.
- `autonomy.cycle.completed`: `cycleId`, `goalId`, `mandateHash`, `attemptCount`, `tokensObserved`, `outcome` (`progressed | blocked | handed_to_proxy | budget_exhausted`), `occurredAt`.
- Failure codes: `candidate_correction_observed` (a later correction resets used-in-practice counting), `autonomy_mandate_missing`, and `recall_corpus_stale`.

Conversation corpus indexes live in `.lervo/state` as rebuildable projections scoped per agent and channel. Events carry identifiers and counts only.

## Safety backstops

Candidates remain unreviewed and labelled wherever disclosed; they cannot change user-owned content. Used-in-practice promotion requires three verified turns and no correction. Mandate ceilings, in-flight token caps, attempt limits, and the error budget bound the daemon. Recall never grants authority or leaves the agent's scope.

## Migration

1. Add observations and single-observation candidates alongside the grouped path; both produce the same candidate types.
2. Ship disclosure to the compact prompt and Discord; measure selected and referenced rates for four weeks before changing defaults.
3. Start the daemon with liveness only, then standing goals on one repository.
4. Relabel the roadmap in the same change as this decision.

## Acceptance (installed)

- A user correction in Claude Code produces a candidate; three later verified turns reference it; promotion records `used_in_practice`; the next prompt's receipt shows the hit.
- A Discord "make that a rule" produces an instruction candidate reviewed from Discord and visible in the Mac CLI.
- The daemon keeps a standing goal progressing for 24 hours with liveness events, at least one proxy handoff, and no budget breach.
- An agent recalls its own earlier commitment from a prior channel conversation, and the receipt records `referenced`.
- At least one portable skill is promoted and activated in a real repository.

## Deferred

Cross-repository skill sharing, automatic promotion without exact review, and provider-native session resume beyond ADR-0395.

## References

- [Hermes differentiation](../../../../research/lervo-product-positioning-and-verified-improvement/product-lessons/hermes-differentiation.md)
- [Retrieval and improvement](../../../../research/lervo-product-positioning-and-verified-improvement/retrieval-and-improvement.md)
- [Prime-Agent-derived execution outcomes](../../../../roadmap/product-outcome-convergence/execution.md)
- [ADR-0413](../../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)

[ADR-0543](../../../knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md) learns portable skills in the resident from single completed, observed turns, with independent review and usage re-evaluation.

# ADR-0453: Act for the owner through a principal mandate

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0386](../0386-organization-teams-and-agent-identities.md), [ADR-0411](0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0412](0412-expand-the-owner-proxy-ceo-through-installed-capabilities.md), [ADR-0398](../../../execution/orchestration/governed-work/0398-outcome-supervision-and-autonomous-team-allocation.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The owner expects the central agent, deployed as "Tarin", to act for them. Today it cannot:

- "Tarin" is an installed deployment identity, not a code concept; `packages/agent-workforce/src/agent-display-identity.ts` is only a hashed name pool. The `ceo` profile (`packages/roles/src/profiles/ceo.ts`) coordinates, delegates, convenes, and proposes; it has no request type that resolves a decision, accepts an outcome, or grants an approval. All capabilities except reads and shell are `require_approval`.
- `packages/work-controller/src/ceo-policy.ts:16-25` has a closed action set and returns `approval_required` (lines 198-203) whenever `approvalId` is null; nothing mints one. The evaluator is reachable only from `lervo organization ceo-evaluate|executive-execute`; `apps/node-runtime` never references it, so Discord turns cannot use it.
- Pending user decisions (`wdec_*`, `packages/schemas/src/workstream.ts:54-81`) are resolved only by replacing the whole workstream snapshot; the chosen option is never recorded, so no decision history exists. `decision_rationale` and `working_preference` memory kinds exist in `agent-context-event.ts:34-42` but are written only by the manual `lervo agent context promote`.
- Pending decisions block `supervision-goal-completion-basis.ts:30-40`, standing successors (`supervision-standing.ts:170-180`), and workstream start plans; `outcome-supervision.ts:232` reports `owner_attention_pending` with no next action. The brief's reading of `waiting_decision` at line 338 was wrong: that flag tracks the supervisor's own uncertain effects, not user decisions.
- The central agent is reactive. Unaddressed priority is pure configuration (`discord-conversation-priorities.ts:26-40`); the installed guild gives the product owner priority 10 in project channels and the central agent 0. Nothing watches attention items, stalled dispatch, `turn_not_owned` loops, or stuck outbound and acts on them.

ADR-0386 and ADR-0412 reserved "owner-only approval" without defining which decisions the owner may delegate. ADR-0398 requires central escalation but routes it back to the human.

## Decision

### Principal mandate

A **principal mandate** is a versioned, owner-installed contract that delegates decision authority to one proxy agent. It is distinct from the operating mandate (`packages/application-contract/src/operating-mandate.ts`), which bounds worker allocation. `PrincipalMandateV1` carries `mandateId`, `version`, `principalId`, `proxyAgentId`, `teamIds`, `decisionKinds` (`workstream_decision`, `outcome_acceptance`, `hire_within_headcount`, `stall_recovery`, `lease_release`, `approval_grant`), `allowedConsequenceClasses`, `maximumHires`, `maximumInterventionsPerHour`, `maximumAggregateTokensPerDay`, `escalationBatchWindowMs`, `issuedAt`, `expiresAt`, and `revocationCoordinate`. `lervo organization principal-mandate install|revoke` is a plan/apply owner command; the Discord owner may install it through the same typed command via natural language. Consequence classes `external_message`, `deploy`, `spend`, `credential`, `security_policy`, and `irreversible_deletion` cannot be granted in version 1.

### Version 1 defaults

The owner accepted these defaults for the first installed mandate (2026-10-04). `decisionKinds`: `workstream_decision`, `outcome_acceptance`, `hire_within_headcount`, `stall_recovery`, and `lease_release`; `approval_grant` stays with the owner until the proxy has two weeks of installed settlement history. `allowedConsequenceClasses`: `read_only`, `conversation`, `repository_internal_reversible`, and `staffing_within_headcount`. Ceilings: `maximumHires` 2 per day, `maximumInterventionsPerHour` 6, `maximumAggregateTokensPerDay` 400,000, `escalationBatchWindowMs` 1,800,000. Expiry is 30 days from installation; renewal is a new reviewed version. The hire grace period is 30 minutes.

### Decisions become typed commands with history

`workstream.decision.resolve` is a new application command. It records `workstream.decision.resolved` and removes the decision through the ordinary reviewed workstream update in one transaction. Humans resolve by natural-language reply (the runtime translates), the proxy resolves under its mandate, and both paths produce the same event, so every decision has a recorded choice and resolver. Each `choice.consequence` is classified by the managed turn into consequence classes before the proxy may act; the proxy settles a decision only when every class of the chosen option is inside `allowedConsequenceClasses`, otherwise it escalates. The recommended choice is the default unless decision memory says otherwise.

`ceo-policy.ts` gains actions `decision.resolve`, `outcome.accept`, `supervision.recover`, `approval.grant`, and `lease.release`. For those actions, a valid principal mandate is the approval source: the decision records `approvalSource: principal_mandate` and the mandate hash instead of `approval_required`. Actions outside the mandate keep today's `approval_required` meaning.

### Proactive intervention loop

A platform-neutral `principal-proxy-loop` in the Node composition wakes on operating-attention changes (ADR-0397 event-driven idle reconciliation) and on a bounded interval. For each item it evaluates `principal-decision-policy` (pure, provider-neutral, in `packages/work-controller`) against the mandate and decision memory, and performs exactly one of:

- **settle**: resolve the decision, accept the verified outcome, approve the in-headcount hire, release the stale writer lease (ADR-0456), or recover the stalled dispatch through the existing supervision recovery commands;
- **escalate**: add the item to the batch for the principal;
- **defer**: record why, with a retry time.

Escalations are published once per batch window to the principal's bound conversation through `ConversationAdapter` with `audienceParticipation: observe_only`, addressing the principal and listing each item with its one-line question and recommended option. The proxy never answers its own escalation. Stall detection covers supervision `owner_attention_pending`, `turn_not_owned` on a human turn with no eventual reply, outbound retry counts above the ADR-0452 attention threshold, and `repository_writer_lease_held_elsewhere` refusals.

`supervision-goal-completion-basis`, `supervision-standing`, and the workstream start plan accept decisions resolved by a valid mandate exactly as human resolutions.

### Decision memory

ADR-0411 is amended so that a `workstream.decision.resolved` event with `resolverKind: human` qualifies as review evidence for a `decision_rationale` memory on the proxy agent, keyed by `consequenceClass + teamId + questionDigest`. Two or more human resolutions with the same class and choice pattern promote a medium-confidence `working_preference`. Proxy settlements record which memory entries they used. Memory remains agent-scoped, non-canonical, and provider-neutral; a settled decision that should become repository policy enters the ADR-0457 conversation-decision knowledge path.

### Boundary with conversation ownership

The proxy's interventions are not conversation turns, so ADR-0391 ownership and ADR-0454 fan-out are untouched. When a human addresses the central agent, ordinary turn rules apply.

## Events, states, and failure meaning

- `organization.principal_mandate.installed` and `.revoked`: `mandateId`, `version`, `principalId`, `proxyAgentId`, `mandateHash`, `decisionKinds`, `allowedConsequenceClasses`, `expiresAt`, `occurredAt`.
- `workstream.decision.resolved`: `workstreamId`, `decisionId`, `questionDigest`, `choiceId`, `consequenceClasses`, `resolverKind` (`human | principal_proxy`), `resolverAgentId` or null, `mandateHash` or null, `memoryEntryIds` used, `occurredAt`. No question text, choice text, or owner message.
- `organization.principal_intervention.recorded`: `interventionId`, `kind` (`decision_settled | outcome_accepted | hire_approved | stall_recovered | lease_released | escalated | deferred`), `targetDigest`, `mandateHash`, `reasonCode` or null, `occurredAt`.
- `organization.principal_escalation.published`: `escalationId`, `proxyAgentId`, `itemCount`, `itemKinds`, `conversationId` or null, `outboundId` or null, `occurredAt`.
- Failure codes: `principal_scope_exceeded` (escalated, nothing settled), `principal_mandate_expired`, `principal_memory_conflict` (contradictory preferences; escalated), `principal_intervention_ceiling` (hourly ceiling reached; items wait).

## Safety backstops

Interventions per hour and tokens per day are mandate ceilings. Hire approvals carry a 30-minute grace period during which the principal's "undo" reverses them through `workforce.agent.retire`; other settlements are immediate because their consequences are in-scope by construction. The proxy never writes repository bytes, sends external messages, deploys, spends beyond the mandate, or touches credentials. Revocation stops the loop before the next item. Every intervention is visible in operating attention and the Mac CLI `lervo workstream current`.

## Migration

Without an installed mandate nothing changes. Installing one activates the loop for its teams. Existing pending decisions are evaluated on first wake; the first installed window runs with `maximumInterventionsPerHour: 6` to observe behaviour before raising it.

## Acceptance (installed, real guild and providers)

1. A worker raises an in-scope decision; the proxy settles it within two minutes without owner input, the event shows `resolverKind: principal_proxy`, and the worker continues.
2. An out-of-scope decision produces one batched escalation that addresses the owner; the owner's natural-language reply records `resolverKind: human`, and a later same-class decision is settled citing that memory.
3. A stalled dispatch (stuck outbound or unanswered human turn) is recovered or escalated within the batch window, and the intervention is listed in `lervo application attention` on the Mac.
4. A standing successor starts after a proxy settlement without a human bookkeeping turn.
5. Revocation during an active batch stops further settlements and leaves no half-applied decision.

## Deferred

Proxy repository writes, external messaging, spend authority, multi-principal organizations, and Hub-mediated mandate distribution.

## References

- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0397](../../sync/0397-event-driven-node-idle-reconciliation.md)
- [ADR-0431](../../../execution/orchestration/governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md)
- [Outcome supervision](../../../../specifications/execution/outcome-supervision.md)
- [Agent organization roadmap](../../../../roadmap/product-outcome-convergence/host-products/agent-organization.md)

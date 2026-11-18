# ADR-0453: Act for the owner through a principal mandate

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0386](../0386-organization-teams-and-agent-identities.md), [ADR-0411](0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0412](0412-expand-the-owner-proxy-ceo-through-installed-capabilities.md), [ADR-0398](../../../execution/orchestration/governed-work/0398-outcome-supervision-and-autonomous-team-allocation.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Amended by: [ADR-0561](../../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (past the escalation bound the proxy decides within the installed operating mandate or holds the item as Lervo debt; it never escalates to the owner)

## Context

The owner expects the central agent, deployed as "Tarin", to act for them. Current barriers:

- "Tarin" is an installed deployment identity, not a code concept; `packages/agent-workforce/src/agent-display-identity.ts` is only a hashed name pool. The `ceo` profile (`packages/roles/src/profiles/ceo.ts`) coordinates, delegates, convenes, and proposes, but has no request type to resolve decisions, accept outcomes, or grant approvals. All capabilities except reads and shell are `require_approval`.
- `packages/work-controller/src/ceo-policy.ts:16-25` has a closed action set and returns `approval_required` (lines 198-203) when `approvalId` is null; nothing mints one. Only `lervo organization ceo-evaluate|executive-execute` reaches the evaluator. `apps/node-runtime` never references it, so Discord turns cannot use it.
- Pending user decisions (`wdec_*`, `packages/schemas/src/workstream.ts:54-81`) resolve only by replacing the whole workstream snapshot. The chosen option is not recorded, leaving no decision history. `decision_rationale` and `working_preference` exist in `agent-context-event.ts:34-42` but are written only by manual `lervo agent context promote`.
- Pending decisions block `supervision-goal-completion-basis.ts:30-40`, standing successors (`supervision-standing.ts:170-180`), and workstream start plans. `outcome-supervision.ts:232` reports `owner_attention_pending` without a next action. Contrary to the brief, `waiting_decision` at line 338 tracks the supervisor's uncertain effects, not user decisions.
- The central agent is reactive. Unaddressed priority is configuration only (`discord-conversation-priorities.ts:26-40`); the installed guild assigns the product owner priority 10 and the central agent 0 in project channels. Nothing watches and acts on attention items, stalled dispatch, `turn_not_owned` loops, or stuck outbound.

ADR-0386 and ADR-0412 reserve "owner-only approval" without defining delegable decisions. ADR-0398 requires central escalation but routes it back to the human.

## Decision

### Principal mandate

A **principal mandate** is a versioned, owner-installed contract delegating decision authority to one proxy agent. It is distinct from the worker-allocation operating mandate (`packages/application-contract/src/operating-mandate.ts`).

`PrincipalMandateV1` carries:

- `mandateId`, `version`, `principalId`, `proxyAgentId`, `teamIds`;
- `decisionKinds`: `workstream_decision`, `outcome_acceptance`, `hire_within_headcount`, `stall_recovery`, `lease_release`, `approval_grant`;
- `allowedConsequenceClasses`, `maximumHires`, `maximumInterventionsPerHour`, `maximumAggregateTokensPerDay`, `escalationBatchWindowMs`;
- `issuedAt`, `expiresAt`, `revocationCoordinate`.

`lervo organization principal-mandate install|revoke` is a plan/apply owner command. The Discord owner may install a mandate through the same typed command using natural language. Version 1 cannot grant consequence classes `external_message`, `deploy`, `spend`, `credential`, `security_policy`, or `irreversible_deletion`.

### Version 1 defaults

The owner accepted these first-installation defaults on 2026-10-04:

- `decisionKinds`: `workstream_decision`, `outcome_acceptance`, `hire_within_headcount`, `stall_recovery`, `lease_release`. `approval_grant` remains with the owner until the proxy has two weeks of installed settlement history.
- `allowedConsequenceClasses`: `read_only`, `conversation`, `repository_internal_reversible`, `staffing_within_headcount`.
- Ceilings: `maximumHires` 2 per day; `maximumInterventionsPerHour` 6; `maximumAggregateTokensPerDay` 400,000; `escalationBatchWindowMs` 1,800,000.
- Expiry: 30 days after installation. Renewal requires a new reviewed version.
- Hire grace period: 30 minutes.

### Decisions become typed commands with history

The new application command `workstream.decision.resolve` records `workstream.decision.resolved` and removes the decision through the ordinary reviewed workstream update in one transaction. The runtime translates human natural-language replies; the proxy resolves under its mandate. Both paths produce the same event, recording the choice and resolver for every decision.

Before proxy action, the managed turn classifies each `choice.consequence` into consequence classes. The proxy settles only if every class of the chosen option is in `allowedConsequenceClasses`; otherwise it escalates. The recommended choice is the default unless decision memory says otherwise.

`ceo-policy.ts` gains `decision.resolve`, `outcome.accept`, `supervision.recover`, `approval.grant`, and `lease.release`. For these actions, a valid principal mandate supplies approval: the decision records `approvalSource: principal_mandate` and the mandate hash instead of `approval_required`. Actions outside the mandate retain `approval_required`.

### Proactive intervention loop

A platform-neutral `principal-proxy-loop` in the Node composition wakes on operating-attention changes (ADR-0397 event-driven idle reconciliation) and a bounded interval. For each item, it evaluates the pure, provider-neutral `principal-decision-policy` in `packages/work-controller` against the mandate and decision memory, then performs exactly one action:

- **Settle:** resolve the decision, accept the verified outcome, approve the in-headcount hire, release the stale writer lease (ADR-0456), or recover stalled dispatch through existing supervision recovery commands.
- **Escalate:** add the item to the principal's batch. As amended by ADR-0561, an escalation is a notice, not a wait: after the escalation bound (eight escalations or 30 minutes of pending attention), outcome supervision lets the proxy settle within the installed operating mandate through `principal-decision-policy`, or records the item as Lervo debt with reason `principal_scope_exceeded` or `principal_mandate_expired`.
- **Defer:** record a reason and retry time.

Once per batch window, escalations publish through `ConversationAdapter` to the principal's bound conversation with `audienceParticipation: observe_only`. They address the principal and list each item's one-line question and recommended option. The proxy never answers its own escalation.

Stall detection covers supervision `owner_attention_pending`, `turn_not_owned` on a human turn with no eventual reply, outbound retry counts above the ADR-0452 attention threshold, and `repository_writer_lease_held_elsewhere` refusals.

`supervision-goal-completion-basis`, `supervision-standing`, and the workstream start plan accept decisions resolved by a valid mandate exactly as human resolutions.

### Decision memory

ADR-0411 is amended: a `workstream.decision.resolved` event with `resolverKind: human` qualifies as review evidence for a proxy-agent `decision_rationale` memory keyed by `consequenceClass + teamId + questionDigest`. Two or more human resolutions with the same class and choice pattern promote a medium-confidence `working_preference`. Proxy settlements record the memory entries used.

Memory remains agent-scoped, non-canonical, and provider-neutral. Settled decisions that should become repository policy enter the ADR-0457 conversation-decision knowledge path.

### Boundary with conversation ownership

Proxy interventions are not conversation turns; ADR-0391 ownership and ADR-0454 fan-out remain unchanged. Human messages addressing the central agent follow ordinary turn rules.

## Events, states, and failure meaning

- `organization.principal_mandate.installed` and `.revoked`: `mandateId`, `version`, `principalId`, `proxyAgentId`, `mandateHash`, `decisionKinds`, `allowedConsequenceClasses`, `expiresAt`, `occurredAt`.
- `workstream.decision.resolved`: `workstreamId`, `decisionId`, `questionDigest`, `choiceId`, `consequenceClasses`, `resolverKind` (`human | principal_proxy`), `resolverAgentId` or null, `mandateHash` or null, `memoryEntryIds` used, `occurredAt`. Excludes question text, choice text, and owner message.
- `organization.principal_intervention.recorded`: `interventionId`, `kind` (`decision_settled | outcome_accepted | hire_approved | stall_recovered | lease_released | escalated | deferred`), `targetDigest`, `mandateHash`, `reasonCode` or null, `occurredAt`.
- `organization.principal_escalation.published`: `escalationId`, `proxyAgentId`, `itemCount`, `itemKinds`, `conversationId` or null, `outboundId` or null, `occurredAt`.
- Failure codes: `principal_scope_exceeded` (escalated; nothing settled), `principal_mandate_expired`, `principal_memory_conflict` (contradictory preferences; escalated), `principal_intervention_ceiling` (hourly ceiling reached; items wait).

## Safety backstops

Interventions per hour and tokens per day are mandate ceilings. During a hire approval's 30-minute grace period, the principal's "undo" reverses it through `workforce.agent.retire`. Other settlements are immediate because their consequences are in scope by construction.

The proxy never writes repository bytes, sends external messages, deploys, spends beyond the mandate, or touches credentials. Revocation stops the loop before the next item. Every intervention is visible in operating attention and the Mac CLI `lervo workstream current`.

## Migration

Without an installed mandate, nothing changes. Installation activates the loop for its teams. Existing pending decisions are evaluated on the first wake. The first installed window uses `maximumInterventionsPerHour: 6` to observe behaviour before raising it.

## Acceptance (installed, real guild and providers)

1. A worker raises an in-scope decision; the proxy settles within two minutes without owner input, the event shows `resolverKind: principal_proxy`, and the worker continues.
2. An out-of-scope decision produces one batched escalation addressing the owner. The owner's natural-language reply records `resolverKind: human`; a later same-class decision is settled citing that memory.
3. A stalled dispatch (stuck outbound or unanswered human turn) is recovered or escalated within the batch window, and its intervention appears in `lervo application attention` on the Mac.
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

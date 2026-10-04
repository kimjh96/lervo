# ADR-0410: Route supervision goal intake by conversational intent

- Status: accepted
- Decision date: 2026-09-16
- Revised: 2026-09-22 to require an exact installed owner binding and managed outcome prose

## Context

The installed owner accepted durable goals only through Discord `/goal` interactions. Ordinary messages classified as repository work entered one native provider turn, even when requesting owner governance of a multi-stage outcome through delegation, verification, and delivery. The command became the intake boundary, occupied one guild-wide name per Discord application, and coupled reusable supervision to one surface.

Goal intake asks an installed owner to bind and govern a durable outcome. Immediate repository work asks one conversational participant to perform a bounded task or inspection. Neither intent grants execution authority: the installed mandate, owner fence, workstream, assignment graph, requester policy, and typed refusal remain authoritative.

## Decision

Natural conversation exposes the provider-neutral `supervision_goal_request` effect only when the responding durable agent is the exact installed supervision owner. The managed turn resolver selects it for durable multi-step outcomes that may span delegation, verification, or multiple turns, and selects `repository_work` for one bounded task or inspection. Mentions are optional participation signals; they never select between these effects.

The immutable conversation intent record stores the selected effect in its existing bounded `effect_json` field, with the message hash, provider/model evidence, confidence, participation, digest, and resolution time. It stores no additional raw text. A missing supervision route makes the effect unavailable. An unavailable or low-confidence selection clarifies without intake. Human requests and separately allowlisted agent requests enter the same supervision responder, which rechecks requester and project scope before the existing admission writer checks durable authority.

The Node no longer registers or handles the guild `/goal` command. Startup configuration removes `outcomeSupervision.goalCommand`. Existing `goal.requested` records remain readable for historical provenance and restart compatibility; new intake requires no command-kind bypass. Operators remove commands left registered by older deployments during upgrade.

`policy.acceptsSupervisionGoals: true` is invalid unless the same Node configuration contains an `outcomeSupervision` binding whose `ownerAgentId` exactly equals that deployment's durable `agentId`. Configuration parsing rejects missing or mismatched authority. The authority-free pending-goal responder and store are absent from active composition. Older authority-free `conversation_goal_intake` rows remain inert historical evidence and are never automatically promoted or replayed.

Normal duplicate, refusal, and historical-command outcomes pass bounded result codes and observed facts to the managed conversation writer instead of publishing application-authored complete-sentence templates.

This change alone creates no workstream, mandate, assignment, provider run, or publication. For an installed owner, a successful response proves only the existing `work.supervision.bound` admission. Typed refusals write no binding event. An unclassified storage or authority failure remains uncertain and surfaces through the normal conversation failure contract.

The single managed turn also writes a brief, request-grounded acknowledgment for `supervision_goal_request`. It states the understood outcome or priority without claiming admission, execution, completion, or verification. The action path releases that reviewed acknowledgment only after a new binding succeeds. Duplicate and refused outcomes instead publish their deterministic verified state. A natural-language binding without its managed acknowledgment fails closed rather than substituting a generic success promise. Historical `goal.requested` events retain a bounded compatibility response.

Exact-source request binding and standing-successor preparation are idempotent. An unclassified admission error enters the bounded conversation retry path as `response_effect_unconfirmed`. Retry reuses the same managed-turn artifact and source identity, follows any already installed successor, and never creates another provider turn. A typed refusal still proves that no request binding was written. Exhaustion publishes the unconfirmed-effect status and tells the requester not to repeat the request before inspection.

## Consequences

Discord and future first-party conversation surfaces can share a semantic intake port without reserving platform command names. Immediate work remains fast and session-scoped; durable goals remain owner-governed. Removing command registration eliminates the cross-application collision that ADR-0409 could only mitigate through manual announcement configuration.

Conversation participation does not silently create execution authority. A deployment without a matching installed owner omits the supervision effect, allowing the managed resolver to choose bounded repository work or clarification without claiming it stored an executable goal.

Historical pending rows remain immutable local evidence: the runtime neither deletes, promotes, nor replays them. Installing authority remains a separate reviewed transition.

## References

- [Natural-language Discord conversation routing](../../../coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [Bind installed supervision requests across surfaces](0401-bind-installed-supervision-requests-across-surfaces.md)
- [Declared goal command announcement](0409-declared-goal-command-announcement.md)
- [Installed supervision request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)

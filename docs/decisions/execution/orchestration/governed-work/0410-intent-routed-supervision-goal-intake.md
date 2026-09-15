# ADR-0410: Route supervision goal intake by conversational intent

- Status: accepted
- Decision date: 2026-09-16

## Context

The installed owner accepted a durable goal only from the Discord `/goal` interaction kind. An ordinary message classified as repository work always entered one native provider turn, even when the person clearly asked the product owner to own a multi-stage outcome through delegation, verification, and delivery. The command consequently became the practical intake boundary, occupied one guild-wide name per Discord application, and coupled a reusable supervision capability to one surface.

Goal intake and immediate repository work are different intents. Intake asks an installed owner to bind and govern a durable outcome. Immediate work asks one conversational participant to perform a bounded task or inspection. Neither choice grants execution authority: the existing installed mandate, owner fence, workstream, assignment graph, requester policy, and typed refusal remain authoritative.

## Decision

Natural conversation exposes the provider-neutral `supervision_goal_request` effect only when the responding durable agent is the installed supervision owner. The managed turn resolver selects it for a durable multi-step outcome that may span delegation, verification, or multiple turns. It selects `repository_work` for one bounded task or inspection. Mentions are optional participation signals and never choose between those effects.

The immutable conversation intent record stores the selected effect in its existing bounded `effect_json` field with the message hash, provider/model evidence, confidence, participation, digest, and resolution time. It stores no additional raw text. A missing supervision route makes the effect unavailable; an unavailable or low-confidence selection clarifies without intake. Human requests and separately allowlisted agent requests then enter the same supervision responder. The responder rechecks requester and project scope before the existing admission writer checks durable authority.

The Node no longer registers or handles the guild `/goal` command, and `outcomeSupervision.goalCommand` is removed from startup configuration. Existing `goal.requested` records remain readable for historical provenance and restart compatibility, but no command-kind bypass is required for new intake. Operators remove any command left registered by an older deployment during upgrade.

When a registered product owner or CEO has no installed supervision binding, the same effect records an immutable owner-only `conversation_goal_intake` row with status `pending_authority`. It binds event, project, intended owner agent, content hash, source-event-key hash, conversation/thread, requester kind/participant/role, and creation time; raw text remains in the existing CAS and interaction record. Exact replay is idempotent, conflicting replay or a capacity beyond 1,024 rows fails closed, and no row is updated or deleted automatically. The response states that the request was retained and no work started. This separates receipt from authority without fabricating a workstream or mandate. Later authority installation and automatic promotion of a pending receipt are separate transitions and must not reinterpret its text or silently execute it.

This change does not create a workstream, mandate, assignment, provider run, or publication by itself. For an installed owner, a successful response proves only the existing `work.supervision.bound` admission. Typed refusals write no binding event. An unclassified storage or authority failure remains uncertain and is surfaced through the normal conversation failure contract.

## Consequences

Discord and future first-party conversation surfaces can share the same semantic intake port without reserving platform command names. Immediate work stays fast and session-scoped; durable goals stay owner-governed. Removing command registration also removes the cross-application collision that ADR-0409 could only mitigate by manual announcement configuration.

Authority-free retention makes a request durable and inspectable but deliberately cannot execute it. A reviewed authority transition must bind or supersede that receipt before work starts; this decision does not silently mint execution authority from conversation participation.

## References

- [Natural-language Discord conversation routing](../../../coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [Bind installed supervision requests across surfaces](0401-bind-installed-supervision-requests-across-surfaces.md)
- [Declared goal command announcement](0409-declared-goal-command-announcement.md)
- [Installed supervision request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)

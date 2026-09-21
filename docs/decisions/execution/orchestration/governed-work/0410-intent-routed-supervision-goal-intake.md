# ADR-0410: Route supervision goal intake by conversational intent

- Status: accepted
- Decision date: 2026-09-16

## Context

The installed owner accepted durable goals only through the Discord `/goal` interaction kind. Ordinary messages classified as repository work entered one native provider turn, even when they clearly asked the product owner to govern a multi-stage outcome through delegation, verification, and delivery. The command became the practical intake boundary, occupied one guild-wide name per Discord application, and coupled reusable supervision to one surface.

Goal intake asks an installed owner to bind and govern a durable outcome. Immediate repository work asks one conversational participant to perform a bounded task or inspection. Neither intent grants execution authority: the installed mandate, owner fence, workstream, assignment graph, requester policy, and typed refusal remain authoritative.

## Decision

Natural conversation exposes the provider-neutral `supervision_goal_request` effect only when the responding durable agent is the installed supervision owner. The managed turn resolver selects it for durable multi-step outcomes that may span delegation, verification, or multiple turns, and selects `repository_work` for one bounded task or inspection. Mentions are optional participation signals and never select between these effects.

The immutable conversation intent record stores the selected effect in its existing bounded `effect_json` field, with the message hash, provider/model evidence, confidence, participation, digest, and resolution time. It stores no additional raw text. A missing supervision route makes the effect unavailable; an unavailable or low-confidence selection clarifies without intake. Human requests and separately allowlisted agent requests enter the same supervision responder, which rechecks requester and project scope before the existing admission writer checks durable authority.

The Node no longer registers or handles the guild `/goal` command. Startup configuration removes `outcomeSupervision.goalCommand`. Existing `goal.requested` records remain readable for historical provenance and restart compatibility, but new intake requires no command-kind bypass. Operators remove commands left registered by older deployments during upgrade.

When a registered product owner or CEO lacks an installed supervision binding, the same effect records an immutable owner-only `conversation_goal_intake` row with status `pending_authority`. The row binds event, project, intended owner agent, content hash, source-event-key hash, conversation/thread, requester kind/participant/role, and creation time. Raw text remains in the existing CAS and interaction record. Exact replay is idempotent; conflicting replay or capacity beyond 1,024 rows fails closed. No row is automatically updated or deleted.

The response states that the request was retained and no work started. Receipt does not fabricate a workstream or mandate. Later authority installation and automatic promotion of a pending receipt are separate transitions; they must not reinterpret its text or silently execute it.

This change alone creates no workstream, mandate, assignment, provider run, or publication. For an installed owner, a successful response proves only the existing `work.supervision.bound` admission. Typed refusals write no binding event. An unclassified storage or authority failure remains uncertain and surfaces through the normal conversation failure contract.

The single managed turn also writes a brief request-grounded acknowledgment for `supervision_goal_request`. It states the outcome or priority understood without claiming admission, execution, completion, or verification. The action path releases that already reviewed acknowledgment only after a new binding succeeds. Duplicate and refused outcomes instead publish their deterministic verified state. A natural-language binding without its managed acknowledgment fails closed rather than substituting a generic success promise. Historical `goal.requested` events retain a bounded compatibility response.

## Consequences

Discord and future first-party conversation surfaces can share a semantic intake port without reserving platform command names. Immediate work remains fast and session-scoped; durable goals remain owner-governed. Removing command registration eliminates the cross-application collision that ADR-0409 could only mitigate through manual announcement configuration.

Authority-free retention makes requests durable and inspectable but cannot execute them. A reviewed authority transition must bind or supersede a receipt before work starts. Conversation participation does not silently create execution authority.

## References

- [Natural-language Discord conversation routing](../../../coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [Bind installed supervision requests across surfaces](0401-bind-installed-supervision-requests-across-surfaces.md)
- [Declared goal command announcement](0409-declared-goal-command-announcement.md)
- [Installed supervision request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)

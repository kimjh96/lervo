# ADR-0419: Preserve human focus and real agent authorship

- Status: accepted
- Decision date: 2026-09-18
Superseded in part by: [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Superseded in part by: [ADR-0454](agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md) (acceptance item 3)

## Context

Installed multi-agent Discord use exposed duplicate answers to human turns, agents answering each other's failure publications, and older worker results appearing to transfer the human conversation to that worker. Hiring and runtime restart could route an unaddressed turn to a new worker; hired work could start without acknowledgement. Provider prose could expose host-owned replica-finalization caveats or leave empty HTML comments after managed-context removal. Routine work also concentrated on an expensive provider when independent reasoning or review did not require it.

These failures conflate independent state: human conversation focus, turn ownership, task assignment, result authorship, formal-deliberation roles, external speaker identity, and execution allocation.

The installed guild already has separately authenticated application bots for the central executive and repository product owners. A same-named webhook or hired agent cannot repair their routing: it creates an indistinguishable second principal and weakens authorship evidence.

## Decision

### Keep conversation and work coordinates separate

Maintain these coordinates independently:

- `humanFocus`: the participant explicitly addressed or replied to by the latest eligible human turn within the bounded idle interval.
- `turnOwner`: the single eligible participant selected to evaluate and possibly answer the current inbound event.
- `taskAssignee`: the hired agent holding the exact assignment or native work lease.
- `publicationAuthor`: the participant whose authenticated bot or webhook deployment sends an outbound.
- `policySeat`: the stakeholder perspective used by a formal deliberation policy.
- `executionRoute`: the provider, model, reasoning effort, and retained session selected for one managed work turn.

Hiring, assignment, acknowledgement, result publication, agent-authored messages, and runtime restart do not mutate `humanFocus`. Only an eligible human's exact participant address or reply sets it; a later unaddressed human turn renews it. Idle expiry or loss of the focused participant releases focus to deterministic channel ownership.

Resolve turn ownership before semantic relevance, typing, or provider execution, in this order: exact participant address, addressed role, retained human focus, deterministic channel default. Every peer observing the same event and candidate roster must select the same owner. Non-owners record `turn_not_owned` and perform no typing, relevance call, provider work, acknowledgement, or reply.

Agent-authored publications cannot become human-focus events. Lervo-owned acknowledgements, progress, failures, deliberation artifacts, and results are observation-only for other agents. A correlated, explicitly addressed agent request may continue one bounded automation chain, but cannot reset its depth or steal the next human turn.

### Make hired work visible without transferring focus

An accepted hire or delegation publishes one origin-bound acknowledgement before runtime reconfiguration. It names the assignee, states the accepted scope, and says work is starting. The assignee owns the task lifecycle and must end it with one verified result, one duplicate-suppression notice, or one bounded terminal failure. Silence is not completion.

The coordinator remains the human's interlocutor unless the human explicitly addresses or replies to the assignee, even when the assignee publishes a result through its real external identity. Reconfiguration persists and reloads `humanFocus` before accepting new ingress.

Delegation carries a natural bounded subtask, not a host-authored persona. The receiving agent retains its durable identity, role, accumulated context, and own action authority. The coordinator may delegate without the human naming a worker, but remains responsible for unassigned work and reconciling the result. Transport templates must not describe the receiver as a generic “responsible delegated agent” or instruct it to replace the coordinator.

### Use existing application bots as identity authority

An external speaker is real only when one reviewed deployment binds its platform principal to the durable participant and hired-agent coordinates and owns delivery. Display labels, policy roles, provider sessions, and copied application names are not speaker identities.

Reuse an agent's existing application-bot binding in the conversation. Do not create a same-named webhook, same-named hired agent, or shadow deployment to repair routing. Webhooks are valid only for an explicitly requested new speaker without an installed application identity whose owner authorizes that provisioning path.

Formal-deliberation policy seats remain internal coverage responsibilities unless canonical organization evidence explicitly binds them to real participants. An unbound seat may produce canonical review evidence, but cannot be a conversation speaker or have its artifact projected as another coordinator personality. Do not replace it with an existing agent's name merely because that agent is present, has a compatible provider, or has a similarly named job.

Actual named-agent deliberation requires the agent's runtime to accept the bounded participation assignment, execute with its verified durable role profile and context policy, and publish through its existing deployment. Ordinary discussion among installed bots uses the peer-agent conversation path; [ADR-0421](agent-organization/0421-separate-real-agent-discussion-from-policy-coverage.md) governs the distributed formal protocol.

### Route execution by work class and preserve evidence

Classify managed repository work before provider admission:

- `routine`: prefer a balanced general model at medium effort.
- `reasoning`: prefer the strongest available reasoning model at high effort.
- `review`: prefer an independent strong reviewer at high effort.

Explicitly provider-bound agents and retained sessions preserve continuity unless policy requires independent review. Selection records the profile, preferred provider, actual provider, model, effort, fallback reason, and session disposition. Attribute token observations to the actual run and provider. Route configuration does not prove selection or use.

### Keep publication and finalization host-owned

Before delivery, project managed context references out of human-facing Markdown. Remove exact recognized evidence comments and empty HTML-comment residue, including inline residue, while preserving ordinary prose and code. Fail publication if projection leaves no publishable content or finds a malformed managed marker.

Replica parity, managed completion evidence, and adapter delivery are host-owned post-exit gates. Provider instructions must not tell users that final completion is withheld because the provider process cannot observe those gates. The host publishes the verified result after required gates pass or sends one ordinary terminal failure. Required replica parity is an explicit deployment option, not the installed single-writer default.

## Acceptance

Installed acceptance uses existing application bots and proves all of the following without fabricating a human request:

1. After a human explicitly addresses agent A and agent B publishes an older result, the next unaddressed human turn still has exactly one owner: A.
2. Hiring or assigning agent C produces one acknowledgement before restart. Human focus survives restart, and C does not answer the human unless addressed or delegated a speaking turn.
3. In a shared project channel, one human instruction cannot produce replies from both the product owner and a worker. Observation-only failure or result messages cannot start an agent reply cascade.
4. Every visible named author matches its configured application or explicitly authorized webhook principal and durable participant and agent binding. No duplicate same-named principal is created.
5. Routine, reasoning, and review fixtures select the expected execution profile and record actual provider, model, effort, session, and exact usage evidence.
6. Provider output containing an exact managed reference and `<!-- -->` or `<!--  -->` publishes clean prose without marker residue.
7. A changed native work turn publishes success only after configured host gates pass and never exposes an in-process replica-finalization caveat.
8. Formal-deliberation policy coverage without an actual participant remains internal. Every visible participant turn was accepted, executed with the durable agent role profile, and delivered through that agent's existing deployment.
9. A delegated task contains only the coordinator's natural bounded subtask, without synthetic persona or original-request/summary boilerplate. The coordinator retains and completes the full human outcome.
10. Opening a configured requested runtime survives the provider turn but creates no boot-enabled service or restart loop. Explicit close, maximum lifetime, and Node shutdown each stop it; an unexpected exit remains stopped until another admitted request.

Synthetic Gateway events and provider fixtures cover deterministic negative and restart cases. Final installed acceptance requires a new human-authored Discord turn: replaying or fabricating the user's message invalidates target and delivery evidence.

## Consequences

Conversation remains natural with deterministic routing. Hiring and work distribution do not redefine the user's interlocutor. Existing application bots remain the identity authority; formal coverage cannot masquerade as a deployed agent. Token distribution becomes observable execution policy rather than a prose promise.

The peer-agent path supports real named-agent discussion across reviewed Node bindings. [ADR-0420](agent-organization/0420-bound-agent-conversation-and-deliberation-routes.md) adds explicit named participation for repository-local, co-resident formal seats; cross-repository formal execution remains a separate authenticated protocol.

## References

- [Deterministic multi-agent conversation turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Named agent identity and installed organization effects](0393-named-agent-identity-and-installed-organization-effects.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
- [Retain deliberation as a bounded decision workflow](../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md)

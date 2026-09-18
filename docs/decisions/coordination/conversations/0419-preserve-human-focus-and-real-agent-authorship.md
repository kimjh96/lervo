# ADR-0419: Preserve human focus and real agent authorship

- Status: accepted
- Decision date: 2026-09-18

## Context

Installed multi-agent Discord use exposed several related failures. Two agents could answer one human turn and then answer each other's failure publications. A result from a previously assigned worker could make that worker appear to become the human's next interlocutor. Hiring and the runtime restart that follows it could move an unaddressed turn to the new worker. A hired worker could begin silently, leaving no visible acknowledgement. Provider prose could expose host-owned replica finalization caveats or a stripped managed-context marker as an empty HTML comment. Routine work also concentrated on one expensive provider even when independent reasoning or review did not require it.

These are not one routing bug. They come from conflating independent state: human conversation focus, turn ownership, task assignment, result authorship, formal-deliberation roles, external speaker identity, and execution allocation.

The installed guild already contains separately authenticated application bots for the central executive and repository product owners. Creating a same-named webhook or a new same-named hired agent does not repair their routing. It introduces a second principal that users cannot distinguish and weakens authorship evidence.

## Decision

### Keep conversation and work coordinates separate

Maintain these coordinates independently:

- `humanFocus`: the participant explicitly addressed or replied to by the latest eligible human turn within the bounded idle interval;
- `turnOwner`: the one eligible participant selected to evaluate and possibly answer the current inbound event;
- `taskAssignee`: the hired agent holding the exact assignment or native work lease;
- `publicationAuthor`: the participant whose authenticated bot or webhook deployment sends an outbound;
- `policySeat`: the stakeholder perspective used by a formal deliberation policy; and
- `executionRoute`: the provider, model, reasoning effort, and retained session selected for one managed work turn.

Hiring, assignment, acknowledgement, result publication, agent-authored messages, and runtime restart do not mutate `humanFocus`. Only an eligible human's exact participant address or reply sets it. A later unaddressed human turn renews that focus. Idle expiry or loss of the focused participant releases it to deterministic channel ownership.

Turn ownership is resolved before semantic relevance, typing, or provider execution. Exact participant address wins, then addressed role, then retained human focus, then the deterministic channel default. Every peer observing the same event and candidate roster must select the same owner. Non-owners record `turn_not_owned` and perform no typing, relevance call, provider work, acknowledgement, or reply.

An agent-authored publication cannot become a new human-focus event. Lervo-owned acknowledgements, progress, failures, deliberation artifacts, and results are observation-only for other agents. A correlated, explicitly addressed agent request may continue one bounded automation chain, but cannot reset its depth or steal the next human turn.

### Make hired work visible without transferring focus

An accepted hire or delegation publishes one origin-bound acknowledgement before any runtime reconfiguration. It names the assignee, states the accepted scope, and says that work is starting. The assignee then owns its task lifecycle and must end it with one verified result, one duplicate-suppression notice, or one bounded terminal failure. Silence is not a completed state.

The coordinator remains the human's interlocutor unless the human explicitly addresses or replies to the assignee. A result may be authored by the assignee's real external identity without changing that rule. Reconfiguration persists and reloads `humanFocus` before accepting new ingress.

### Use existing application bots as identity authority

An external speaker is real only when one reviewed deployment binds the platform principal to the durable participant and hired-agent coordinates and that deployment owns delivery. A display label, policy role, provider session, or copied application name is not a speaker identity.

When an application bot is already bound for an agent in the conversation, Lervo must reuse that binding. It must not create a same-named webhook, same-named hired agent, or shadow deployment as a routing repair. Webhooks remain valid only for an explicitly requested new speaker that has no installed application identity and whose owner authorizes that provisioning path.

Formal-deliberation policy seats remain stakeholder roles unless canonical organization evidence explicitly binds them. A role label may be published as a role label. It must not be replaced with an existing agent's name merely because the agent is present, has a compatible provider, or has a similarly named job. Actual named-agent deliberation requires that agent's runtime to accept the bounded participation assignment, execute the turn under its durable identity, and publish through its existing deployment. Until a distributed participation protocol provides those three proofs, formal artifacts remain honestly policy-labeled. Ordinary multi-agent discussion among installed bots uses the existing peer-agent conversation path instead.

### Route execution by work class and preserve evidence

Classify managed repository work into `routine`, `reasoning`, or `review` before provider admission:

- `routine` prefers a balanced general model at medium effort;
- `reasoning` prefers the strongest available reasoning model at high effort; and
- `review` prefers an independent strong reviewer at high effort.

Explicitly provider-bound agents and retained sessions keep continuity unless policy requires independent review. Selection records the profile, preferred provider, actual provider, model, effort, fallback reason, and session disposition. Token observations remain attributed to the actual run and provider. Configuring a route does not prove it was selected or used.

### Keep publication and finalization host-owned

Before delivery, project managed context references out of human-facing Markdown. Remove exact recognized evidence comments and empty HTML-comment residue, including inline residue, while preserving ordinary prose and code. If projection leaves no publishable content or finds a malformed managed marker, fail publication instead of sending ambiguous text.

Replica parity, managed completion evidence, and adapter delivery are host-owned post-exit gates. Provider instructions must not tell the user that final completion is withheld because the provider process cannot observe those gates. The host either publishes the verified result after required gates pass or sends one ordinary terminal failure. Required replica parity remains an explicit deployment option, not the installed single-writer default.

## Acceptance

Installed acceptance uses the existing application bots and proves all of the following without fabricating a human request:

1. A human explicitly addresses agent A, agent B publishes an older result, and the next unaddressed human turn still has exactly one owner: agent A.
2. Hiring or assigning agent C produces one acknowledgement before restart; after restart the human focus is unchanged, and C does not answer the human unless addressed or delegated a speaking turn.
3. In a shared project channel, one human instruction cannot produce replies from both the product owner and a worker, and observation-only failure or result messages cannot start an agent reply cascade.
4. Every visible named author matches the configured application or explicitly authorized webhook principal and its durable participant and agent binding. No duplicate same-named principal is created.
5. Routine, reasoning, and review fixtures select the expected execution profile and record actual provider, model, effort, session, and exact usage evidence.
6. Provider output containing an exact managed reference and `<!-- -->` or `<!--  -->` publishes clean prose with no marker residue.
7. A changed native work turn publishes success only after the configured host gates pass and never exposes an in-process replica-finalization caveat.
8. Formal-deliberation policy roles remain role-labeled unless an actual agent runtime accepted, executed, and delivered that participant turn through its existing deployment.

Synthetic Gateway events and provider fixtures cover deterministic negative and restart cases. Final installed acceptance requires a new human-authored Discord turn because replaying or fabricating the user's message would invalidate target and delivery evidence.

## Consequences

Conversation remains natural while routing is deterministic. Hiring and work distribution no longer redefine who the user is talking to. Existing application bots remain the identity source of truth. Formal decision roles cannot masquerade as deployed agents, and token distribution becomes an observable execution policy rather than a prose promise.

The existing peer-agent path can support real named-agent discussion now. A later distributed deliberation-participation protocol is required before the formal workflow can claim that cross-node application bots themselves produced its stakeholder turns.

## References

- [Deterministic multi-agent conversation turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Named agent identity and installed organization effects](0393-named-agent-identity-and-installed-organization-effects.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
- [Retain deliberation as a bounded decision workflow](../../execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md)

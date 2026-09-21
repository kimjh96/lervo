# ADR-0421: Separate real-agent discussion from policy coverage

- Status: accepted
- Decision date: 2026-09-18

## Context

The installed formal-deliberation surface treated five configured policy perspectives as five visible speakers. Only one perspective was bound to a real hired agent; the coordinating application bot published the other four under headings such as operations, security, observability, or core knowledge reviewer. This made one agent appear to have several personalities, ignored the installed agents' own roles and accumulated context, required manual policy-seat routes, concentrated execution on the coordinator, and consumed the exact best-case call ceiling before final verification and decision.

Policy coverage, agent identity, discussion participation, and execution allocation are different concerns. A coverage rule can require security or repository evidence without inventing a security reviewer. A real agent can challenge several concerns without changing identity. A visible speaker must always be an authenticated deployed participant.

## Decision

### Select agents; do not cast personas

Natural multi-agent discussion selects from current exact peer and organization bindings. Eligibility requires an active membership, active conversation deployment, current role version and hashes, an accepted source and target route, and an available receiver runtime. Selection ranks the smallest sufficient set by durable role capabilities, repository and context ownership, provider independence where useful, current workload, and remaining execution budget. Display names, role-name similarity, or a static list of stakeholder titles cannot create eligibility.

The selected agent keeps its durable identity, verified role profile, context policy, retained session rules, and local knowledge. The discussion request is a bounded assignment layered on that identity; it does not replace the agent's personality with a temporary reviewer persona. The visible author is the existing application bot or authorized webhook already bound to that participant.

Policy concerns become internal coverage requirements. They may influence participant selection, evidence retrieval, verification, and the decision owner's checklist, but never appear as speakers unless an actual selected agent owns that contribution. Unbound coverage artifacts stay internal.

### Use a receiver-owned distributed turn protocol

Cross-Node discussion cannot be inferred from a Discord name or run centrally under another agent's session. Each remote turn uses an authenticated assignment envelope containing a discussion ID, turn ID, parent turn ID, source and target agent bindings, conversation scope, task digest, shared-context digest, deadline, automation depth, execution profile, and idempotency key. The receiver verifies its current membership and route, accepts or rejects once, executes in its own runtime and context namespace, records exact provider, model, effort, and usage evidence, and returns a content-addressed result envelope. Only the receiver publishes its human-facing contribution.

The transport may be Hub-backed or another reviewed authenticated adapter. Discord content is presentation, not the canonical control envelope. Hidden HTML comments, copied mentions, policy labels, and provider compatibility are not authentication.

New protocol states are `discussion.requested`, `discussion.participant.accepted`, `discussion.turn.completed`, `discussion.turn.rejected`, `discussion.converged`, and `discussion.failed`. Required fields are the IDs and hashes above, timestamps, bounded reason codes, and content coordinates where applicable. Events exclude message bodies, prompts, credentials, private reasoning, and provider payloads. Rejection means no provider call occurred. Failure means no final decision was adopted. A participant timeout releases its lease. The coordinator returns a bounded non-converged synthesis when at least one verified contribution exists, or a fixed terminal result without a provider call when none exists. It never silently waits or invents the missing participant.

### Converge adaptively and reserve completion

The coordinator admits a turn only after reserving the calls, observed-token allowance, and elapsed time required for independent verification and the decision-owner synthesis. It asks for a new turn only when an accepted agent can add evidence, a distinct objection, or an answer to an unresolved objection. Duplicate agreement does not earn another round. Once blockers are resolved, the decision owner synthesizes once and verification runs once. If the reserve would be violated, the workflow stops admitting optional turns and returns a bounded no-consensus result rather than failing after spending the completion budget.

Model allocation follows responsibility, not one global default. Routine collection and formatting use a balanced general model at medium effort. Architecture, ambiguous diagnosis, trade-off decisions, and synthesis use the strongest approved reasoning model at high effort. Independent audit and acceptance use a strong reviewer from a different provider or session at high effort when available. Configuration records eligibility; actual run telemetry proves selection and usage.

Each provider route may also bind its own execution timeout. The receiver applies that timeout to the same managed plan that selected the provider, model, and effort; a routine response timeout must not terminate a slower high-effort review. Read-only discussion generation publishes only after a verified terminal result, so a provider start or terminal-turn failure may consume one policy-bounded retry. Protocol, stream, publication, and state-ambiguity failures remain terminal to prevent uncertain replay.

### Fail before visible work when identity is insufficient

A natural discussion is not offered as formal multi-agent work unless at least two independently bound participant runtimes and one eligible decision owner can complete the reserved plan. Missing remote protocol support, stale roles, ambiguous authorship, or insufficient completion reserve fails preflight with no provider call and no fabricated speaker. The caller may still request one agent's ordinary answer, but the product must not label it a multi-agent debate.

Terminal conversation output carries the canonical bounded reason. Budget exhaustion, participant-binding invalidity, verification failure, and source inconsistency are not collapsed into a generic safety sentence. The message states whether partial work was adopted and whether an automatic retry will occur.

## Acceptance

1. A General-channel discussion between at least three agents on different Nodes shows only their installed bot identities; every contribution maps to one active participant, agent, role contract, execution route, and result envelope.
2. Each participant receives its own verified role and context policy. No prompt or visible heading assigns a static stakeholder persona, and no coordinator publishes another participant's words.
3. PO-to-PO, PO-to-hired-agent, and hired-agent-to-hired-agent turns use the same authenticated receiver-owned protocol and bounded automation depth.
4. Restart after any accepted turn resumes from canonical envelopes without duplicate publication, focus transfer, or provider replay.
5. A fixture with one available agent does not start a multi-agent discussion or spend provider tokens.
6. A repair-heavy fixture retains verification and decision reserve, ending in convergence or `no_consensus` rather than `deliberation_budget_exhausted` after partial visible rounds.
7. Routine, reasoning, and review turns record different approved model, effort, and bounded timeout profiles, and per-agent usage demonstrates distribution instead of attributing all work to the coordinator.
8. Discord output contains no empty or evidence-bearing HTML comment residue and creates no same-named webhook or shadow agent.

## Consequences

The compatibility path keeps formal policy evidence canonical but no longer exposes unbound policy seats as people. Bound seats execute with the agent's durable role profile and publish without synthetic headings. Formal policy deliberation remains distinct from natural agent discussion.

The installed natural path uses the authenticated Discord Gateway adapter and exact `peerAgents` bindings as its reviewed transport. A versioned nonce carries the coordination kind, the first-or-second assignment sequence when applicable, and the opaque discussion ID. Distinct assignment nonces prevent Discord idempotency from treating the serialized second assignment as a replay of the first. Each receiver reconstructs and persists the complete hash-bound envelope, executes under its own durable agent and role context, and returns a content-addressed contribution through its existing bot identity. The source selects two independent remote runtimes but activates their review turns serially in deterministic target order: the first accepted contribution produces the remaining participant's idempotent assignment. The adapter resolves the first visible bot address through the reviewed identity binding and records that normalized participant as the assignment's explicit active target; mention arrays remain canonical sets and never encode scheduling order. Only that exact participant owns the assignment. This retains two independent reviews while preventing concurrent high-effort provider processes from exhausting a shared installed host. The coordinator waits for both verified contributions and performs one high-effort synthesis only after the second review completes. Deadline processing is durable and restart-safe; partial or absent participation ends visibly without fabricated speakers. Routine, review, and synthesis execution use the configured execution profiles and retain per-agent managed execution evidence.

A contribution is authenticated by its coordination nonce, exact peer binding, discussion roster, and reply correlation to the origin. The durable discussion runtime resolves coordination ownership before general mention ownership: only the stored coordinator owns a valid contribution, while mentioned non-coordinators observe it. Native Discord replies do not have to repeat the coordinator mention in their visible body. A coordination message that cannot satisfy the protocol is observe-only and cannot fall through to the ordinary conversational responder; this prevents an invalid or partially recognized contribution from being mistaken for a final synthesis. Deterministic assignment and deadline replies use the same fixed writing contract at creation and publication verification, while participant contributions and final synthesis retain their managed conversation contracts.

An independent assignment receives no earlier contribution by design and must not report that isolation as a defect or attempt the coordinator's synthesis. The final synthesis receives the current event actor as a separate verified speaker plus speaker coordinates on every earlier accepted turn, and it must not merge participants merely because they share a role. Repository knowledge remains available for substantive judgment, but injected workstream status is historical unless the current turn supplies fresh evidence; neither a participant nor the coordinator may promote an old failure or deployment claim into current discussion state without that evidence.

## References

- [ADR-0386](../0386-organization-teams-and-agent-identities.md)
- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md)
- [ADR-0420](0420-bound-agent-conversation-and-deliberation-routes.md)

# ADR-0421: Separate real-agent discussion from policy coverage

- Status: accepted
- Decision date: 2026-09-18

## Context

The installed formal-deliberation surface presented five configured policy perspectives as five speakers, although only one was bound to a hired agent. The coordinating application bot published the other four under operations, security, observability, or core knowledge reviewer headings. This made one agent appear to have several personalities, ignored installed agents' roles and accumulated context, required manual policy-seat routes, centralized execution, and consumed the exact best-case call ceiling before final verification and decision.

Policy coverage, agent identity, discussion participation, and execution allocation are separate concerns. Coverage can require security or repository evidence without inventing a reviewer; one real agent can challenge several concerns without changing identity. Every visible speaker must be an authenticated deployed participant.

## Decision

### Select agents; do not cast personas

Natural multi-agent discussion selects current exact peer and organization bindings. Eligibility requires active membership and conversation deployment, current role version and hashes, accepted source and target routes, and an available receiver runtime. Selection ranks the smallest sufficient set by durable role capabilities, repository and context ownership, provider independence where useful, current workload, and remaining execution budget. Display names, role-name similarity, and static stakeholder titles cannot create eligibility.

Each selected agent keeps its durable identity, verified role profile, context policy, retained session rules, and local knowledge. A discussion request adds a bounded assignment without replacing the agent's personality with a temporary reviewer persona. The visible author is the existing application bot or authorized webhook bound to that participant.

Policy concerns become internal coverage requirements that may influence selection, evidence retrieval, verification, and the decision owner's checklist. They appear as speakers only when an actual selected agent owns the contribution. Unbound coverage artifacts remain internal.

### Use a receiver-owned distributed turn protocol

Cross-Node discussion cannot be inferred from a Discord name or run centrally under another agent's session. Every remote turn uses an authenticated assignment envelope containing:

- Discussion ID, turn ID, and parent turn ID.
- Source and target agent bindings and conversation scope.
- Task digest and shared-context digest.
- Deadline, automation depth, execution profile, and idempotency key.

The receiver verifies its current membership and route, accepts or rejects once, executes in its own runtime and context namespace, records exact provider, model, effort, and usage evidence, and returns a content-addressed result envelope. Only the receiver publishes its human-facing contribution.

Transport may be Hub-backed or another reviewed authenticated adapter. Discord content is presentation, not the canonical control envelope. Hidden HTML comments, copied mentions, policy labels, and provider compatibility are not authentication.

Protocol states are `discussion.requested`, `discussion.participant.accepted`, `discussion.turn.completed`, `discussion.turn.rejected`, `discussion.converged`, and `discussion.failed`. Required fields include the IDs and hashes above, timestamps, bounded reason codes, and content coordinates where applicable. Events exclude message bodies, prompts, credentials, private reasoning, and provider payloads.

Rejection means no provider call occurred; failure means no final decision was adopted. Participant timeout releases its lease. With at least one verified contribution, the coordinator returns a bounded non-converged synthesis; with none, it returns a fixed terminal result without a provider call. It never silently waits or invents a missing participant.

### Converge adaptively and reserve completion

Before admitting a turn, the coordinator reserves calls, observed-token allowance, and elapsed time for independent verification and decision-owner synthesis. It requests another turn only when an accepted agent can add evidence, a distinct objection, or an answer to an unresolved objection. Duplicate agreement earns no additional round. Once blockers are resolved, the decision owner synthesizes once and verification runs once. If a turn would violate the reserve, optional admissions stop and the workflow returns bounded no-consensus rather than failing after spending the completion budget.

Model allocation follows responsibility:

- Routine collection and formatting use a balanced general model at medium effort.
- Architecture, ambiguous diagnosis, trade-off decisions, and synthesis use the strongest approved reasoning model at high effort.
- Independent audit and acceptance use a strong reviewer from a different provider or session at high effort when available.

Configuration records eligibility; actual run telemetry proves selection and usage.

Each provider route may bind its own execution timeout. The receiver applies it to the same managed plan that selected provider, model, and effort; a routine response timeout must not terminate a slower high-effort review. Read-only discussion generation publishes only after a verified terminal result, allowing one policy-bounded retry for a provider start or terminal-turn failure. Protocol, stream, publication, and state-ambiguity failures remain terminal to prevent uncertain replay.

### Fail before visible work when identity is insufficient

Natural discussion is offered as formal multi-agent work only when at least two independently bound participant runtimes and one eligible decision owner can complete the reserved plan. Missing remote protocol support, stale roles, ambiguous authorship, or insufficient completion reserve fails preflight without a provider call or fabricated speaker. A caller may request one agent's ordinary answer, but the product must not label it a multi-agent debate.

Terminal conversation output carries the canonical bounded reason. Budget exhaustion, participant-binding invalidity, verification failure, and source inconsistency must not collapse into a generic safety sentence. The message states whether partial work was adopted and whether automatic retry will occur.

## Acceptance

1. A General-channel discussion among at least three agents on different Nodes shows only installed bot identities. Every contribution maps to one active participant, agent, role contract, execution route, and result envelope.
2. Each participant receives its verified role and context policy. No prompt or visible heading assigns a static stakeholder persona; no coordinator publishes another participant's words.
3. PO-to-PO, PO-to-hired-agent, and hired-agent-to-hired-agent turns share the authenticated receiver-owned protocol and bounded automation depth.
4. Restart after any accepted turn resumes from canonical envelopes without duplicate publication, focus transfer, or provider replay.
5. A fixture with one available agent neither starts multi-agent discussion nor spends provider tokens.
6. A repair-heavy fixture retains verification and decision reserve, ending in convergence or `no_consensus` rather than `deliberation_budget_exhausted` after partial visible rounds.
7. Routine, reasoning, and review turns record different approved model, effort, and bounded timeout profiles. Per-agent usage demonstrates distributed work rather than attributing it all to the coordinator.
8. Discord output contains no empty or evidence-bearing HTML comment residue and creates no same-named webhook or shadow agent.

## Consequences

### Formal policy compatibility

The compatibility path keeps formal policy evidence canonical without exposing unbound seats as people. Bound seats execute with the agent's durable role profile and publish without synthetic headings. Formal policy deliberation remains distinct from natural agent discussion.

### Installed natural discussion

The installed natural path uses the authenticated Discord Gateway adapter and exact `peerAgents` bindings as reviewed transport. A versioned nonce carries coordination kind, first-or-second assignment sequence when applicable, and opaque discussion ID. Distinct assignment nonces prevent Discord idempotency from treating the serialized second assignment as a replay of the first.

Each receiver reconstructs and persists the complete hash-bound envelope, executes under its own durable agent and role context, and returns a content-addressed contribution through its existing bot identity. The source selects two independent remote runtimes and activates reviews serially in deterministic target order. The first accepted contribution produces the remaining participant's idempotent assignment.

The adapter resolves the first visible bot address through the reviewed identity binding and records that normalized participant as the assignment's explicit active target. Mention arrays remain canonical sets and never encode scheduling order. Only the exact active target owns the assignment. This preserves two independent reviews while preventing concurrent high-effort provider processes from exhausting a shared installed host.

The coordinator waits for both verified contributions and performs one high-effort synthesis only after the second review completes. Deadline processing is durable and restart-safe; partial or absent participation ends visibly without fabricated speakers. Routine, review, and synthesis use configured execution profiles and retain per-agent managed execution evidence.

### Coordination ownership and publication

A contribution is authenticated by coordination nonce, exact peer binding, discussion roster, and reply correlation to the origin. The durable discussion runtime resolves coordination ownership before general mention ownership: only the stored coordinator owns a valid contribution; mentioned non-coordinators observe it. Native Discord replies need not repeat the coordinator mention in their visible body.

A coordination message that fails the protocol is observe-only and cannot fall through to the ordinary conversational responder. This prevents invalid or partially recognized contributions from being mistaken for final synthesis. Deterministic assignment and deadline replies use the same fixed writing contract at creation and publication verification; participant contributions and final synthesis retain their managed conversation contracts.

### Independent evidence and speaker context

An independent assignment intentionally receives no earlier contribution. It must neither report that isolation as a defect nor attempt the coordinator's synthesis. Final synthesis receives the current event actor as a separate verified speaker and speaker coordinates for every earlier accepted turn. It must not merge participants because they share a role.

Repository knowledge remains available for substantive judgment. Injected workstream status is historical unless the current turn supplies fresh evidence; neither participant nor coordinator may promote an old failure or deployment claim into current discussion state without that evidence.

## References

- [ADR-0386](../0386-organization-teams-and-agent-identities.md)
- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md)
- [ADR-0420](0420-bound-agent-conversation-and-deliberation-routes.md)

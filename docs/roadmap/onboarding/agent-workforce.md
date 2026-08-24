# Repository onboarding and agent workforce

Status: `planned`
As of: 2026-08-24

## Problem

`lervo init` creates minimum repository identity and knowledge policy but does not complete knowledge migration, provider integration, readiness checks, or repository-team setup. The installed CLI executes a developer role. Researcher, marketer, and designer definitions are disconnected from installed execution; writer and ideation roles are absent. Lervo lacks a durable agent roster, hiring lifecycle, general assignment queue, and natural-language dispatcher.

## Product outcome

A repository owner starts with `lervo init`. Lervo discovers supported local providers and repository sources, creates a reviewable onboarding transaction, requests only decisions requiring human authority, completes safe generated stages, reports native provider trust actions, and proves readiness. The owner can then assign work in ordinary language without running Lervo bookkeeping commands.

An agent is not a prompt persona. A durable agent record binds a stable agent ID, role contract and version, allowed provider profile, capabilities, skills, responsibility scope, repository membership, status, and creation evidence. A role is reusable; an agent is one repository-scoped assignee. Provider sessions are replaceable execution instances, not identity or memory.

## Required workflow

1. `init` plans the complete onboarding lifecycle: minimum configuration, source discovery, document and skill migration, provider bridges, terminal hooks, lint, and readiness.
2. Safe generated-only stages may continue automatically. Existing user bytes, provider configuration, external effects, and authority changes retain exact review or native trust boundaries.
3. Repository-scoped agents may be created, suspended, resumed, and retired without deleting their evidence or durable outputs.
4. Initial executable roles cover developer, researcher, marketer, designer, writer, and ideation. Each role defines inputs, capabilities, skills, output schema, evaluation, publication, and handoff rules.
5. Natural-language requests resolve an explicit task type and assignee. Ambiguous authority, role, scope, or external effect becomes a bounded pending decision, not an inferred assignment.
6. Assignments have stable IDs, priority, dependencies, acceptance criteria, verification suites, approval requirements, workstream linkage, and terminal states. Conversation text is not the task record.
7. Handoffs bind exact artifacts and context evidence. Another agent must load the handoff through the ordinary evidence pipeline; shared conversation memory is never assumed.
8. Task finalization automatically refreshes deterministic knowledge and promotes durable outcomes to canonical documents. Rewriting user content or promoting semantic claims still requires the applicable review contract.
9. Local execution works without a Hub. Optional Hub coordination may replicate authorized roster and assignment coordinates but cannot transfer approval authority.

## Acceptance

- A new repository reaches provider-ready status from `lervo init` without extra bookkeeping commands from the user.
- The user can ask in natural language to hire a role, assign work, inspect progress, resolve a pending decision, and retire an agent.
- Every accepted assignment is resumable in a fresh Codex or Claude session and on another authorized repository node.
- Role-specific artifacts pass their declared schema, evaluation, writing, and project verification gates.
- Generated knowledge becomes current after successful task finalization; unsafe or semantic user-document changes remain reviewable and unapplied without approval.
- Schemas, events, diagnostics, and UI distinguish role, agent, provider session, task, workstream, and evidence identities.

## Dependencies

- [Evidence-bound specialist roles](../../decisions/execution/orchestration/0051-evidence-bound-multi-discipline-roles.md)
- [Managed provider role registry](../../decisions/execution/providers/0155-managed-provider-role-registry.md)
- [Natural-language terminal finalization](../../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md)
- [Structured workstream continuation](../../decisions/knowledge/repository/0199-structured-workstream-continuation-state.md)
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)

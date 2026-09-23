# Repository onboarding and agent workforce

Status: `complete`
As of: 2026-08-24
Completed: 2026-08-25

## Problem

`lervo init` created minimum repository identity and knowledge policy but did not complete knowledge migration, provider integration, readiness checks, or repository-team setup. Only the developer role was installed for execution; researcher, marketer, and designer were disconnected, while writer and ideation were absent. Lervo also lacked a durable roster, hiring lifecycle, assignment queue, and natural-language dispatcher.

## Product outcome

A repository owner starts with `lervo init`. Lervo discovers supported local providers and repository sources, creates a reviewable onboarding transaction, requests only decisions requiring human authority, completes safe generated stages, reports native provider trust actions, and proves readiness. The owner can then assign work in ordinary language without bookkeeping commands.

An agent's durable record binds a stable agent ID, role contract and version, allowed provider profile, capabilities, skills, responsibility scope, repository membership, status, and creation evidence. A role is reusable; an agent is one repository-scoped assignee. Provider sessions are replaceable execution instances, not identity or memory. An agent is not a prompt persona.

## Required workflow

1. `init` plans minimum configuration, source discovery, document and skill migration, provider bridges, terminal hooks, lint, and readiness.
2. Safe generated-only stages may continue automatically. Existing user bytes, provider configuration, external effects, and authority changes retain exact review or native trust boundaries.
3. Repository agents may be created, suspended, resumed, and retired without deleting evidence or durable outputs.
4. Executable templates cover developer, researcher, marketer, designer, writer, and ideation. Each defines inputs, capabilities, skills, output schema, evaluation, publication, and handoff rules. Repository roles may define, specialize, or compose equally executable versioned contracts.
5. Natural-language requests resolve an explicit task type and assignee. Ambiguous authority, role, scope, or external effect becomes one bounded pending decision, never an inferred assignment.
6. Assignments have stable IDs, priority, dependencies, acceptance criteria, verification suites, approval requirements, workstream linkage, and terminal states. Conversation text is not the task record.
7. Handoffs bind exact artifacts and context evidence. Recipients load them through the ordinary evidence pipeline; shared conversation memory is never assumed.
8. Finalization automatically refreshes deterministic knowledge and assesses changed-path responsibility. The agent must bind every changed noncanonical source to exact updated canonical bytes, a no-durable-change rationale, or proposed Markdown in a local review candidate. Lervo does not rewrite or promote user-owned semantic content implicitly.
9. Local execution works without a Hub. Optional Hub coordination may replicate authorized roster and assignment coordinates but cannot transfer approval authority.

## Acceptance

- A new repository reaches provider-ready status from `lervo init` without extra user bookkeeping commands.
- Natural language can hire a role, assign work, inspect progress, resolve a pending decision, and retire an agent.
- Every accepted assignment is resumable in a fresh Codex or Claude session and on another authorized repository node.
- Role-specific artifacts pass declared schema, evaluation, writing, and project verification gates.
- Successful finalization makes deterministic generated knowledge current and records unmatched durable evidence as a review candidate; semantic canonical updates require responsible content and applicable approval.
- Schemas, events, diagnostics, and UI distinguish role, agent, provider session, task, workstream, and evidence identities.

## Dependencies

- [Evidence-bound specialist roles](../../decisions/execution/orchestration/0051-evidence-bound-multi-discipline-roles.md)
- [Managed provider role registry](../../decisions/execution/providers/0155-managed-provider-role-registry.md)
- [Natural-language terminal finalization](../../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md)
- [Structured workstream continuation](../../decisions/knowledge/repository/0199-structured-workstream-continuation-state.md)
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)

## Completion evidence

[ADR-0205](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md) defines and implements the workforce. Its owner-only roster and assignment store uses atomic compare-and-swap revisions, short scheduler locks, renewable generation-bound leases, dependency checks, and ancestor-aware path-conflict detection. Disjoint same-role and mixed-role work runs concurrently; overlapping work cannot be claimed. Root agents and subagents share the lifecycle, with explicit parent identity and bounded delegation depth.

All six built-in roles, including researcher recognized as `researcher`, `연구자`, or `리서처`, have executable capability, input, output, evaluation, verification, publication, and handoff profiles. [ADR-0209](../../decisions/execution/orchestration/0209-versioned-repository-role-contracts.md) adds lazy repository-defined roles, exact-version specialization, conservative composition, deterministic contract hashes, and fail-closed legacy compatibility. Managed runs bind role version and hash, agent, assignment, lease, paths, provider, and exact verification suites before provider creation. Handoffs bind artifact hashes and context-evidence event IDs, not conversation memory. Natural-language Korean and English lifecycle requests produce privacy-bounded, digest-only plans; repository instructions require execution of unambiguous operations and represent ambiguity as one bounded pending decision.

Production `lervo init` continues safe generated onboarding stages, creates the initial developer agent, stops only at user-owned bytes, provider-native trust, or external authority, and reports the pending boundary. Tests cover built-in and custom-role hiring, specialization and composition, version/hash drift, same-role and mixed-role concurrency, overlap rejection, lease renewal and reclaim, dependency ordering, CAS conflict, event rollback, nested subagents, exact handoff, natural-language researcher and custom-role intent, managed role and assignment binding, and onboarding without user bookkeeping commands.

Terminal retired agents remain inspectable with their stored version and hash after a former custom-role source is removed. This does not reactivate those agents or relax current-role checks for active and suspended workers; it prevents historical roster entries from blocking new, independently validated assignments.

## Planned workspace extension

This completed milestone covers declared path conflicts within the existing workforce store. The separate [isolated agent workspace lifecycle](agent-workspace-lifecycle.md) plans shared coordination across sibling Git worktrees, worker/integrator finalization, immutable sealing, optional Hub reservations, and evidence-bound automatic worktree removal. Its planned status does not reopen or overstate this milestone's completed acceptance.

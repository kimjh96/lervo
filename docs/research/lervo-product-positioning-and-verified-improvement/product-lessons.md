# Product boundaries and adaptable lessons

## Product boundaries

| Product     | Primary layer                                        | Lesson for Lervo                                                                                                                         | Boundary to preserve                                                                                                                                    |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paperclip   | Agent-organization operations                        | Goals, projects, issues, routines, budgets, and an approachable operating view                                                           | Project a view over Lervo contracts; an application database must not become authoritative for repository truth.                                        |
| Buzz        | Shared human-agent workspace                         | Rooms, threads, mentions, workflows, searchable events, and agents as collaboration participants                                         | Route interaction into identity, assignment, authority, evidence, and handoff contracts; channel membership alone must not expand repository authority. |
| Prime Agent | Long-running execution harness                       | Resumable sessions, bounded autonomous continuation, subagents, direct agent communication, goals, heartbeats, and reviewable refinement | Keep provider behavior behind adapters; convert runtime lessons into reviewable candidates rather than self-modifying the core.                         |
| Hermes      | Adaptive personal agent                              | Progressive skill disclosure, tool search, session recall, durable memory, agent-managed skills, and approval gates                      | Personal memory and agent-authored skills are not canonical repository truth.                                                                           |
| Lervo       | Repository agent-work control and extension platform | Knowledge, identity, policy, workstreams, assignments, evidence, verification, and portable continuity                                   | Remain local-first, provider-neutral, canonical-source-led, extensible, and explicit about unobservable behavior.                                       |

These products do not form one replacement hierarchy. Paperclip-like operating views and Buzz-like collaboration surfaces can sit above Lervo. Prime Agent, Hermes, Codex, and Claude can operate below it through provider and execution adapters. This responsibility model is neither a required dependency graph nor an integration commitment to a named product.

## Adaptable ideas

### From Paperclip

- Build a deterministic operating board over workstreams, agents, assignments, blockers, approvals, verification, usage, and cost.
- Add objectives and routines only when they resolve to bounded Lervo work and authority.
- Prefer warnings and inspectable projections before hard monetary stops.

### From Buzz

- Add threads, mentions, inbox routing, and acknowledgments over existing agent identity, assignment, handoff, and deliberation contracts.
- Keep message delivery, acknowledgment, assignment creation, action, and verified result separate.
- Let people and agents share a collaboration surface without granting identical repository capabilities merely because they share a room.

### From Prime Agent

- Support attach, detach, resume, goals, heartbeats, and bounded autonomous continuation over a current workstream.
- Allow recursive workers and direct messages only through durable identity, ancestry, scoped leases, path-conflict checks, evidence, and finalization.
- Represent runtime refinement as reviewable supplemental instructions, skill candidates, or agent-profile candidates, never as unreviewed core self-modification.

### From Hermes

- Extend progressive disclosure from repository documents to capabilities and tool schemas so only relevant definitions consume context.
- Offer source-to-skill candidate creation from a user-selected source while preserving source hashes, permissions, resources, review, and activation evidence.
- Reuse approval history only as a policy candidate signal. Prior approval does not grant new authority.
- Distinguish recommendation, selection, verified loading, provider activation, invocation, and semantic use.

## Differentiation from Hermes

Hermes may remain stronger as a broad personal assistant with conversational memory, messaging, immediate adaptation, and many built-in tools. Lervo should not compete across that entire surface.

Lervo can be stronger for repository and agent-workforce improvement through:

- Canonical sources rather than hidden personal memory.
- Exact provenance, scope, ownership, and approval.
- Provider-neutral evidence across agents and runtimes.
- Stale detection, rejection, supersession, and rollback.
- Verification-bound promotion instead of agent confidence.
- Scoped reuse by a repository workforce rather than one assistant profile.
- Reproducibility on another device or clean clone without a Hub.
- Post-promotion outcome measurement.

The intended contrast is:

> Hermes remembers and adapts quickly. Lervo enables a repository and its agent
> workforce to improve safely from evidence.

This is scoped differentiation, not a claim that Lervo is universally better than Hermes.

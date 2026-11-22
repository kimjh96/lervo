# ADR-0209: Versioned repository role contracts

- Status: accepted
- Decision date: 2026-08-25
- Amended by: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (repository role bindings refresh without an approval)

> **Amended (2026-11-02).** Under ADR-0561, repository-defined role drift is no longer `review_required` and `--approve-role-binding` is removed. The role source is repository bytes that `lervo role validate` checks, so the migration refreshes repository bindings like built-in ones and reports them as `repositoryRoleRefreshes`. Each binding-change event records the previous binding. Reverting the role source in Git and running `lervo upgrade --apply` again restores it.

## Context

The initial workforce supported six validated, hard-coded role IDs but could not define domain specialists, combine disciplines, or bind agents to immutable custom-role versions. Arbitrary labels leave capabilities, required context, outputs, evaluation, publication, and handoff behavior undefined.

## Decision

### Role sources and resolution

Keep developer, researcher, marketer, designer, writer, and ideation as built-in `1.0.0` templates, each with a deterministic contract hash over its complete definition. Researcher is canonical for requests that name it in English (`researcher`) or with either common Korean word for researcher.

A repository may add `.lervo/roles/<role-id>.json` only when authoring its first custom role; the directory remains absent until then. Tracked JSON sources contain schema version 1, kind `lervo_repository_role`, a repository-unique role ID, semantic version, exact `{ roleId, version }` ancestry references, a bounded profile patch, and evaluation checks. Custom IDs cannot replace built-ins. Read only physical files. Malformed JSON, unknown fields, unsafe names, oversized registries, duplicate IDs, cycles, ancestry deeper than eight levels, and stale base versions fail before workforce or provider execution.

Zero-base sources define complete roles. Specialized roles inherit one role. Composed roles may inherit multiple built-in or repository roles but must explicitly name and describe themselves and select one output contract. Request types, required inputs, document rules, skills, verification suites, handoff recipients, and evaluation checks merge deterministically. Conflicting inputs or checks fail. Capabilities merge to the most restrictive decision; patches may tighten but never silently loosen inherited policy. Verification-failure disposition also merges conservatively.

Resolution validates the final RoleProfile and evaluation bundle, then hashes the resolved definition and exact ancestry coordinates. `lervo role list`, `role show`, and `role validate` expose current versions and hashes without mutating repository bytes.

### Workforce bindings and upgrades

Agents bind role ID, version, contract hash, profile hash, and capability hash. Assignments bind role ID, version, and contract hash. Claim, renewal, handoff, managed execution, and completion resolve the current repository contract and fail closed on drift. Legacy built-in agent and assignment state is accepted only when stored profile and capability hashes match the current built-in contract; the next ordinary mutation upgrades generated state. Custom roles use the same root-agent and subagent identity, lease, path-conflict, dependency, handoff, verification, and finalization transitions as built-ins.

Retirement is terminal. A structurally valid retired agent with a stored role version and contract hash remains inspectable as history after its repository role source is removed. Its stored binding is not silently refreshed against a different current role. Archival reads grant no claim, execution, renewal, or reactivation authority. Active and suspended agents still require current role, capability, and ancestry validation. Legacy retired records without the exact stored role binding require a resolvable source rather than an invented binding.

When a shipped built-in definition changes and generated workforce state no longer matches, `lervo upgrade` exposes a content-bound workforce role-binding stage. Exact apply refreshes each stale built-in agent and assignment separately, advances its revision, and records the canonical transition event before Node reconciliation.

Repository-defined role drift is `review_required`. The plan groups stale records by role and exposes one content-bound operation ID and approval hash for the exact target role contract. `--approve-role-binding <operation-id>=<approval-hash>` authorizes only the listed bindings; it neither rewrites the user-owned role source nor authorizes another role, target hash, or later plan. Without approval, safe built-in refreshes may converge while repository bindings remain unchanged. Partial failure claims no completed stage; a later plan binds and resumes only the remaining stale records.

### Events and evidence

`agent.registered` and `assignment.created` add `roleVersion` and `roleContractHash`. Built-in agent refresh reuses `agent.identity.changed` with `changeKind=role_binding`. Assignment refresh records `assignment.role.binding.changed` with assignment ID, previous and next role version and contract hash, role ID, and revision.

Refreshing a completed assignment must not retroactively erase a previously settled result and exact owner review. Outcome supervision may project that historical settled revision only when every later revision forms a contiguous, system-authored `assignment.role.binding.changed` chain. Its first previous binding must match the settled responsibility, and its final binding must match current generated state. Any non-administrative revision, missing event, chain gap, task-contract change, or final mismatch invalidates historical acceptance.

These events retain only opaque IDs, versions, and hashes. They exclude role prose, source paths, profile bodies, task prose, prompts, outputs, credentials, and reasoning. Missing or rejected events restore the individual state file and mean its mutation did not commit. Invalid, missing, stale, cyclic, or incompatible role contracts prove no execution.

## Consequences

Repositories can create domain roles without changing Lervo code; built-ins remain stable starter templates. Composition is deterministic and cannot accidentally widen capabilities. Editing a role invalidates bound agents and assignments until an exact per-role workforce lifecycle decision is supplied and canonical record transitions commit. Reusing a version cannot hide byte drift because the contract hash also changes.

## References

- [Conflict-safe repository agent workforce](0205-conflict-safe-repository-agent-workforce.md)
- [Execution specification](../../../specifications/execution.md)
- [Repository onboarding and agent workforce](../../../roadmap/onboarding/agent-workforce.md)

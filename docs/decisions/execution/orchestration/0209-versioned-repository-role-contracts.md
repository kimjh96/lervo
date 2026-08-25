# ADR-0209: Versioned repository role contracts

- Status: accepted
- Decision date: 2026-08-25

## Context

The initial workforce admitted only six hard-coded role IDs. Although validated, they could not define domain specialists, combine disciplines, or bind agents to immutable custom-role versions. Arbitrary labels are unsafe because capabilities, required context, outputs, evaluation, publication, and handoff behavior would be undefined.

## Decision

Keep developer, researcher, marketer, designer, writer, and ideation as built-in `1.0.0` templates. Researcher is the canonical built-in role for English `researcher` and Korean `연구자` or `리서처` requests. Every built-in template has a deterministic contract hash over its complete definition.

A repository may add `.lervo/roles/<role-id>.json` only when writing its first custom role. The tracked JSON source has schema version 1, kind `lervo_repository_role`, a repository-unique role ID, semantic version, exact `{ roleId, version }` ancestry references, a bounded profile patch, and evaluation checks. Custom IDs cannot replace built-ins. Only physical files are read. Malformed JSON, unknown fields, unsafe names, oversized registries, duplicate IDs, cycles, ancestry deeper than eight levels, and stale base versions fail before workforce or provider execution.

Zero-base sources define a complete role. A specialized role inherits one role. A composed role may inherit multiple built-in or repository roles and must explicitly name and describe itself and select one output contract. Request types, required inputs, document rules, skills, verification suites, handoff recipients, and evaluation checks merge deterministically. Conflicting inputs or checks fail. Capabilities merge to the most restrictive decision, and patches may tighten but never silently loosen inherited policy. Verification-failure disposition also merges conservatively.

Resolution validates the final RoleProfile and evaluation bundle, then hashes the resolved definition and exact ancestry coordinates. `lervo role list`, `role show`, and `role validate` expose current versions and hashes without mutating repository bytes. The role directory remains absent until the first source is authored.

Agents bind role ID, version, contract hash, profile hash, and capability hash. Assignments bind role ID, version, and contract hash. Claim, renewal, handoff, managed execution, and completion resolve the current repository contract and fail closed on drift. Legacy built-in agent and assignment state is accepted only when stored profile and capability hashes match the current built-in contract; the next ordinary mutation upgrades generated state. Custom roles use the same root-agent and subagent identity, lease, path-conflict, dependency, handoff, verification, and finalization transitions as built-ins.

`agent.registered` and `assignment.created` add `roleVersion` and `roleContractHash`. These events retain opaque IDs, versions, and hashes only. They exclude role prose, source paths, profile bodies, prompts, outputs, credentials, and reasoning. Missing or rejected events mean the state mutation did not commit. Invalid, missing, stale, cyclic, or incompatible role contracts prove no execution.

## Consequences

Repositories can create domain roles without changing Lervo code, while built-ins remain stable starter templates. Composition is deterministic and cannot accidentally widen capabilities. Editing a role invalidates bound agents and assignments until a new workforce lifecycle decision is recorded. Reusing a version cannot hide byte drift because the contract hash also changes.

## References

- [Conflict-safe repository agent workforce](0205-conflict-safe-repository-agent-workforce.md)
- [Execution specification](../../../specifications/execution.md)
- [Repository onboarding and agent workforce](../../../roadmap/onboarding/agent-workforce.md)

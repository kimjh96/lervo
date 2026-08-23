# ADR-0156: Local Skill Resolution in the Managed Provider Host

- Status: accepted
- Decision date: 2026-08-22

## Context

`lervo run --skill` already verifies local packages and writes `skills.lock` plus `skill.resolved` without injecting or invoking skills. The Node host fixed resolved skills as empty. Remote commands contain no skill IDs, so deriving them from request text would break authority and reproducibility.

## Decision

`remoteCommands.providerHost.developerSkills` is a unique startup allowlist of 0–16 skill IDs copied into `developer.defaultSkills`. Custom roles use registered defaults under the same constraints. Nonempty `developerSkills` is invalid unless developer is allowed.

After validating project, role, and suites—but before provider creation—the host uses the existing resolver for only requested IDs under project `.agents/skills` and user `~/.agents/skills`. Existing package hash, scope, provider, role, runtime, platform, available-tool, and allowed-capability checks apply. `require_approval` is never elevated to a compatible capability. Atomically update `.lervo/skills.lock` and pass resolutions as coordinator `resolvedSkills`.

`run.requested`, `run.resolved`, and `skill.resolved` commit together. Skill bodies are neither added to context nor invoked, so emit no context loaded/injected, `skill.invoked`, `skill.completed`, or actual-use claim. The lock is derived state, not execution evidence.

Authority comes from local configuration and startup profiles, not Hub authors. Command-specific skill selection requires a future schema and policy. Full profiles and skill IDs are indirectly bound by the policy-version digest but are not copied into remote receipts.

Invalid configuration fails before network access. Existing discovery, hash, compatibility, ambiguity, and lock codes fail before provider creation. Post-reservation failure becomes `execution_failed` without replay. Events retain only ID, version, content hash, source kind, and trust status—never URI, reviewers, bodies, absolute paths, or provider errors.

## Consequences

Fixtures verify project-pinned custom-role resolution, lock and event evidence, multi-file completion, developer snapshot validation, role binding, and existing resolver and restart failures. This decision resolves skills but does not invoke them.

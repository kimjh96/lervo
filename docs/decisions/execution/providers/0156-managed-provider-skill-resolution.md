# ADR-0156: Local Skill Resolution in the Managed Provider Host

- Status: accepted
- Decision date: 2026-08-22

## Context

lervo run --skill already verifies local packages and writes skills.lock plus skill.resolved without injecting or invoking them. The Node host fixed resolved skills empty. Remote commands carry no skill IDs, so inferring them from request text would break authority and reproducibility.

## Decision

remoteCommands.providerHost.developerSkills is a unique 0–16 skill-ID startup allowlist copied into developer.defaultSkills. Custom roles use their registered defaults under the same constraints. Nonempty developerSkills is invalid when developer is not allowed.

After project, role, and suite validation but before provider creation, the host uses the existing resolver for only requested IDs under project .agents/skills and user ~/.agents/skills. Existing package hash, scope, provider, role, runtime, platform, available-tool, and allowed-capability checks apply. require_approval is never elevated to compatible capability. The atomic .lervo/skills.lock is updated and resolutions enter coordinator resolvedSkills.

run.requested, run.resolved, and skill.resolved commit together. Skill bodies are neither placed in context nor invoked, so no context loaded/injected, skill.invoked/completed, or actual-use claim is made. The lock is derived state, not execution evidence.

Authority comes from local config/startup profiles, not Hub authors. Command-specific skill selection requires a future schema/policy. Full profiles and skill IDs are indirectly bound by the policy-version digest but not copied into remote receipts.

Invalid config fails before network; existing discovery/hash/compatibility/ambiguity/lock codes fail before providers. Post-reservation failure becomes execution_failed without replay. Events retain only ID, version, content hash, source kind, and trust status—never URI, reviewers, bodies, absolute paths, or provider errors.

## Consequences

Fixtures verify project-pinned custom-role resolution, lock/event evidence, multi-file completion, developer snapshot validation, role binding, and existing resolver/restart failures. This resolves but does not invoke skills.

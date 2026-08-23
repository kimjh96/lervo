# ADR-0155: Explicit Managed Provider Host Role Registry

- Status: accepted
- Decision date: 2026-08-22

## Context

Hardcoded developer checks in policy and executor could diverge as roles expand. Configuration strings do not prove a role is registered or immutable. Existing researcher, marketer, and designer contracts require structured inputs, writing/publication gates, evaluation, capabilities, and suites not yet enforced by the current remote request and adapters.

## Decision

`remoteCommands.providerHost.roles` is a unique allowlist of 1–16 role IDs. At startup, one `ManagedProviderHostRoleRegistry` must resolve every configured role before network or command execution. Policy and executor share the same immutable snapshot. Unlisted roles or suite mismatches never create providers.

The default registry supplies developer. For each execution it copies the signed command's 1–16 suites while fixing all other terms. Custom profiles are immutable startup dependencies. Reject developer overrides, duplicate IDs, and more than fifteen custom profiles.

Custom profiles must:

- require no structured input;
- define at most sixteen unique default skills;
- require E3 and references;
- produce machine-only output without writing policy;
- allow filesystem reads and shell;
- require approval for writes;
- deny network, messaging, deployment, and data mutation; and
- use fixed suites exactly matching the command.

This is the enforceable Codex/Claude intersection. Provider allowlist, signed approval, per-path permit, E1/E2/E3, and actual verification remain independent controls. The complete role profile enters the coordinator policy-version digest.

Researcher, marketer, and designer remain absent until their input, writing/publication, evaluation, and adapter capability contracts are connected. Definitions alone are not execution evidence.

Invalid configuration fails before network access. Registry, profile, and host mismatches and command denial retain bounded codes. Add no event or durable registry; changing startup snapshots requires restart. Receipts and events gain no descriptions, inputs, or provider payloads. Registry resolution proves no execution, content use, skill use, or publication.

## Consequences

Fixtures verify immutable custom profiles, fixed suites, override/capability/skill rejection, a maintainer multi-generation run, allowlist startup validation, and developer regressions. The installed CLI still defaults to developer only; embedding applications must provide both a safe registered profile and a matching allowlist.

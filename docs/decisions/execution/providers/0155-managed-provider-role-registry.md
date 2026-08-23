# ADR-0155: Explicit Managed Provider Host Role Registry

- Status: accepted
- Decision date: 2026-08-22

## Context

Hardcoded developer checks in policy and executor could diverge when roles expand. Config strings alone do not prove a role is registered or immutable. Existing researcher, marketer, and designer contracts require structured inputs, writing/publication gates, evaluation, capabilities, and suites that the current remote request and adapters do not yet enforce.

## Decision

remoteCommands.providerHost.roles is a unique allowlist of 1–16 role IDs. At startup, one ManagedProviderHostRoleRegistry must resolve every configured role before network or command execution. Policy and executor share the same immutable snapshot. Unlisted roles or suite mismatch never create providers.

The default registry supplies developer. It copies the signed command's 1–16 suites per execution while fixing all other terms. Custom profiles are startup dependencies copied immutably; developer override, duplicate IDs, and more than fifteen custom profiles are rejected.

Custom profiles must have no structured required input, at most sixteen unique default skills, required E3/references, machine-only output without writing policy, filesystem read allow, write require_approval, shell allow, network/message/deploy/data mutation deny, and fixed suites exactly matching the command. This is the enforceable Codex/Claude intersection. Provider allowlist, signed approval, per-path permit, E1/E2/E3, and actual verification remain independent controls; full role profile enters the coordinator policy-version digest.

Researcher, marketer, and designer are intentionally absent until their input, writing/publication, evaluation, and adapter capability contracts are wired. Definitions alone are not execution evidence.

Invalid config fails before network. Registry/profile/host mismatches and command denial retain bounded codes. No event or durable registry is added; startup snapshots require restart to change. Receipts/events gain no descriptions, inputs, or provider payloads, and registry resolution proves no execution, content use, skill use, or publication.

## Consequences

Fixtures verify immutable custom profiles, fixed suites, override/capability/skill rejection, a maintainer multi-generation run, allowlist startup validation, and developer regressions. Installed CLI still defaults to developer only; embedding applications must supply both a safe registered profile and matching allowlist.

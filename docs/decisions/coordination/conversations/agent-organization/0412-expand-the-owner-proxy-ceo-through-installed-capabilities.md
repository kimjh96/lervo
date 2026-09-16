# ADR-0412: Expand the owner-proxy CEO through installed capabilities

- Status: accepted
- Decision date: 2026-09-16

## Context

The built-in CEO described organization coordination but denied shell execution, lacked explicit computer-use permission, and exposed `team.create` only as a request type, without an executable organization action. The organization-executive CLI selected only a Discord adapter and required Discord configuration even for future non-Discord effects. These gaps limited the CEO relative to the owner and coupled executive action installation to the first conversation surface.

Owner equivalence must not bypass policy. Filesystem mutation, external messages, deployment, data mutation, and computer control have different destinations, replay properties, and failure meanings. A provider feature flag does not grant authority: available, selected, activated, and used remain distinct claims.

## Decision

The CEO is the owner's broad operational proxy within an exact `CeoPolicy`. Its built-in role allows shell execution and requires approval for filesystem writes, network access, external messages, deployment, data mutation, and the new `computer.use` capability. Other built-in roles deny computer use unless a reviewed repository role explicitly grants it. Capability packages may require `computer.use`; provider adapters must still activate the exact MCP server or provider plugin and retain activation and use evidence.

`team.create` is an organization action. The installed `repository_organization_v1` effect adapter binds an already initialized repository to the exact organization, team ID, and team kind. The target root must appear in the executive command's explicit team-root allowlist. Conflicting existing bindings are terminal rejections. The common executive policy, effect-hash, replay, receipt, and uncertain-outcome contracts remain unchanged.

Executive adapter selection is surface-neutral. Repository effects do not load Discord configuration. Discord effects require an exact deployed integration and administration allowlist. Product-host protocol v7 reports the shared route as `installed_effect`, because the selected adapter may perform a repository mutation or external delivery.

The CEO does not inherit raw owner credentials, implicit approval, unrestricted destination access, or authority to bypass provider and platform adapters. Maximum capability means every installed, policy-approved action can be exercised; uninstalled or unobservable actions must not be reported as available.

## Consequences

An owner can install a browser or computer-control capability package for the CEO and approve its exact use without granting it to every worker. The CEO can create a new repository-backed team without Discord and continue creating allowlisted Discord resources through the same replay-safe executive boundary.

A first-party Lervo surface can invoke the same organization effect contract without importing Discord configuration or reimplementing team authority. New effect adapters must declare exact actions, validate destinations, keep credentials outside canonical events, and distinguish rejection from an uncertain result.

## References

- [Named agent identity and installed organization effects](../0393-named-agent-identity-and-installed-organization-effects.md)
- [Coordination and authority](../../../../architecture/system/agent-organization/coordination-and-authority.md)
- [Provider-confirmed capability activation](../../../execution/providers/0211-provider-confirmed-capability-activation.md)

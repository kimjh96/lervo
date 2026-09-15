# ADR-0412: Expand the owner-proxy CEO through installed capabilities

- Status: accepted
- Decision date: 2026-09-16

## Context

The built-in CEO described organization coordination but denied shell execution, had no explicit computer-use permission, and exposed `team.create` as a request type without an executable organization action. The organization-executive CLI also selected only a Discord adapter and required Discord configuration even for a future non-Discord effect. These gaps made the CEO materially less capable than the owner and coupled executive action installation to the first conversation surface.

Owner equivalence cannot safely mean bypassing policy. Filesystem mutation, external messages, deployment, data mutation, and computer control have different destinations, replay properties, and failure meanings. Treating a provider feature flag as granted authority would also collapse available, selected, activated, and used into an unsupported claim.

## Decision

The CEO is the owner's broad operational proxy within an exact `CeoPolicy`. Its built-in role allows shell execution and requires approval for filesystem writes, network access, external messages, deployment, data mutation, and the new `computer.use` capability. Other built-in roles deny computer use unless a reviewed repository role explicitly grants it. Capability packages may require `computer.use`; provider adapters still have to activate the exact MCP server or provider plugin and retain activation and use evidence.

`team.create` is an organization action. The installed `repository_organization_v1` effect adapter binds an already initialized repository to the exact organization, team ID, and team kind. Its target root must appear in the executive command's explicit team-root allowlist. Existing conflicting bindings are terminal rejections. The common executive policy, effect-hash, replay, receipt, and uncertain-outcome contracts remain unchanged.

Executive adapter selection is surface-neutral. Repository effects do not load Discord configuration. Discord effects still require an exact deployed integration and administration allowlist. Product-host protocol v7 reports their shared route as `installed_effect`, because the selected adapter may perform a repository mutation or an external delivery.

The CEO does not inherit raw owner credentials, implicit approval, unrestricted destination access, or authority to bypass provider and platform adapters. Maximum capability means every installed, policy-approved action can be exercised, not that uninstalled or unobservable actions are reported as available.

## Consequences

An owner can install a browser or computer-control capability package for the CEO and approve its exact use without granting that power to every worker. The CEO can create a new repository-backed team without Discord and can continue to create allowlisted Discord resources through the same replay-safe executive boundary.

A first-party Lervo surface can invoke the same organization effect contract. It does not need to import Discord configuration or reimplement team authority. New effect adapters must declare exact actions, validate destinations, preserve credentials outside canonical events, and distinguish rejection from an uncertain result.

## References

- [Named agent identity and installed organization effects](../0393-named-agent-identity-and-installed-organization-effects.md)
- [Coordination and authority](../../../../architecture/system/agent-organization/coordination-and-authority.md)
- [Provider-confirmed capability activation](../../../execution/providers/0211-provider-confirmed-capability-activation.md)

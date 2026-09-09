# Identity and authority

Participant identity, read-only execution role, and mutation command role are distinct. Human mappings carry no role. At startup, resolve the configured responding agent ID from the workforce store; the agent must be active with current role and provider-policy hashes. A role template is not an actor.

Agent-authored discussion is disabled by default. When enabled, deterministic turn ownership runs before relevance: one participant responds to unaddressed messages, while exact participant mentions and one owner per mentioned role remain addressable. Participation rate and automation depth impose separate bounds. A non-owner records `turn_not_owned` without typing or provider work. Agent-authored discussion cannot request repository mutation through conversation routing.

An uncorrelated agent message starts at the maximum automation depth unless the current participant binding explicitly marks that exact identity as an automation-chain starter. A reviewed starter begins at depth zero but gains no repository, organization, or platform-effect authority from that designation. This keeps ordinary bot-loop suppression as the default while allowing an appointed coordinating agent to initiate a bounded conversation through a replaceable surface.

Agent-authored repository continuation and platform effects have a second, independent opt-in. The runtime admits them only for an exact configured participant and role within the tenant-derived mapped conversation. Admission routes through the existing signed continuation or allowlisted effect adapter and never expands command roles, effect kinds, provider capabilities, or repository permissions.

Workforce provider authority may be fixed to Codex or Claude or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, and availability, capability, cost, and latency checks. It must fail closed when no candidate qualifies.

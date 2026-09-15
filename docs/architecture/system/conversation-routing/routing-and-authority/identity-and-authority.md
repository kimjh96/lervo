# Identity and authority

Participant identity, read-only execution role, and mutation command role are distinct. Human mappings carry no role. At startup, the configured responding agent ID must resolve from the workforce store to an active agent with current role and provider-policy hashes. A role template is not an actor.

## Conversation ownership

Agent-authored discussion is disabled by default. When enabled, deterministic turn ownership precedes relevance:

- One non-source participant may respond to an unaddressed human or agent message after semantic relevance evaluation.
- Exact participant mentions remain addressable.
- One owner per mentioned role remains addressable.
- Participation rate and automation depth impose separate bounds.
- A non-owner records `turn_not_owned` without typing or provider work.
- Agent-authored discussion remains bounded by automation depth, cooldown, rate limits, and exact effect-request authority; an unaddressed agent turn never bypasses those checks.

## Discord identity mapping

The Discord adapter resolves native mention metadata through configured participant identities. When notification suppression omits that metadata, an exact leading participant address enters the same identity mapping. Quoted, embedded, and unknown addresses cannot create ownership.

A reply reference implicitly addresses its referenced agent only when the author is human. Bot and webhook replies retain correlation without starting an unaddressed acknowledgement loop. Explicit participant mentions remain addressable. These rules neither widen authority nor add event fields.

## Automation chains

An uncorrelated agent message starts at maximum automation depth unless the current participant binding explicitly marks that exact identity as an automation-chain starter. A reviewed starter begins at depth zero but gains no repository, organization, or platform-effect authority.

Ordinary bot-loop suppression remains the default. An appointed coordinating agent may initiate a bounded conversation through a replaceable surface.

## Continuations and effects

Agent-authored repository continuation and platform effects require a second, independent opt-in. The runtime admits them only for an exact configured participant and role within the tenant-derived mapped conversation.

Admission uses the existing signed continuation or allowlisted effect adapter. It never expands command roles, effect kinds, provider capabilities, or repository permissions.

## Provider authority

Workforce provider authority may be fixed to Codex or Claude, or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, and availability, capability, cost, and latency checks. It must fail closed when no candidate qualifies.

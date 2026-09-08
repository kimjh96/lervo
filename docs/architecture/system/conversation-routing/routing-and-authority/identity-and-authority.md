# Identity and authority

Participant identity, read-only execution role, and mutation command role are distinct. Human mappings carry no role. At startup, resolve the configured responding agent ID from the workforce store; the agent must be active with current role and provider-policy hashes. A role template is not an actor.

Agent-authored discussion is disabled by default. When enabled, deterministic turn ownership runs before relevance so one unaddressed participant responds, while exact participant mentions and one owner per mentioned role remain addressable. Participation rate and automation depth provide separate bounds. A non-owner records `turn_not_owned` without typing or provider work. Agent-authored discussion cannot request repository mutation through conversation routing.

Workforce provider authority may be fixed to Codex or Claude or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, and availability, capability, cost, and latency checks. It must fail closed when no candidate qualifies.

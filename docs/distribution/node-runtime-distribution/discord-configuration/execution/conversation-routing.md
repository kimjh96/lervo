# Discord conversation routing

Natural routing defaults `policy.maxAutomationDepth` to eight. Direct agent or role mentions can sustain a bounded bot-to-bot exchange. Unaddressed agent-authored reports are observed without a response; collaborating agents must mention the next participant.

Discord delivery suppresses notification pings. If Discord omits mention metadata, an exact leading `<@user-id>` or `<@!user-id>` followed by whitespace or the end of the message still identifies the addressed participant. Inline references, quoted text, code, escaped mentions, and role tokens do not create this fallback address. The configured identity map, automation depth, turn ownership, and effect authority still apply; text alone grants no authority. Routing uses existing normalized mention fields and adds no event or raw identifier to canonical event payloads.

A unique explicit address or human-authored Discord reply assigns later unaddressed human turns to the same agent until another explicit address changes the bounded in-memory owner. Agent-authored replies preserve reply correlation, but the reference alone does not address another agent. A bot or webhook must explicitly name the next participant to continue an automated exchange; a plain acknowledgement cannot start another response.

A deployment ignores Discord mentions absent from its reviewed participant map; they never fall through to stable unaddressed ownership. Every installed bot sharing a channel must bind all other eligible bot principals, including the central manager. Exact configured and same-process peer entries are deduplicated only when their hired-agent coordinates agree.

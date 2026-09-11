# Discord conversation routing

Natural routing defaults `policy.maxAutomationDepth` to eight. Direct agent or role mentions can sustain a bounded bot-to-bot exchange. Unaddressed agent-authored reports are observed without generating another response; an agent must mention the next participant when it needs collaboration.

A unique explicit address or Discord reply keeps later unaddressed human turns with the same agent until another explicit address changes the bounded in-memory owner.

A Discord mention absent from the current deployment's reviewed participant map is ignored by that deployment and never falls through to stable unaddressed ownership. Every installed bot sharing a channel must bind all other eligible bot principals, including the central manager. Exact configured and same-process peer entries are deduplicated only when their hired-agent coordinates agree.

# Turn ownership and identity evidence

The platform-neutral turn-ownership contract uses the common source-event hash and conversation roster before semantic relevance or provider work. Exact participant mentions address those participants; role mentions select one member per role; unaddressed messages select one eligible participant. A non-owner records `turn_not_owned` without starting typing or claiming semantic irrelevance.

Hired-agent participants retain the agent ID, exact role version, contract hash, and profile hash in platform bindings and normalized message history. Each deployment keeps its own durable interaction store and supplies bounded recent turns only to that agent's responder. Role contracts, provider sessions, bot credentials, and conversation history remain independently replaceable.

On deployment restart, an exact external principal still bound to the same hired-agent ID may refresh its current role ID, version, contract hash, and profile hash. A different agent ID or participant ID fails closed. This projection refresh never rewrites prior normalized messages: historical turns retain the role snapshot recorded when each event was created.

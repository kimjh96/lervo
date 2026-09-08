# Durable inbox retry and failure handling

Accepted interactions are persisted before provider work. Active response work renews its inbox lease; the installed managed-provider composition starts with a five-minute bounded lease. Generation or publication failure returns the inbox record to a time-bounded pending state.

A conversation-owned retry loop processes one ready record at a time without another Discord message, independently of Gateway control traffic, and recovers expired leases after process interruption. Selection requires exact current integration, policy, and role coordinates. Older-policy pending records are retained but cannot block current work or acquire the current policy's meaning.

History reconciliation recovers messages that reached Discord while the Node process was unavailable. Durable inbox retry recovers messages already normalized and correlated before processing failed. Neither substitutes for the other.

`interaction_retry_failed` means the worker could not safely inspect or advance its durable inbox. The Node marks conversation health unavailable and exits through its existing supervised failure path. The health code contains no message or provider output.

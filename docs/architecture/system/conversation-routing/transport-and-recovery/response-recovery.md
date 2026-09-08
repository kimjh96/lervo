# Response recovery

Accepted interactions are persisted before provider work. Generation or publication failure returns the inbox record to a time-bounded pending state. A conversation-owned retry loop processes one ready record at a time without another Discord message, independently of Gateway control traffic, and recovers expired leases after process interruption. Selection requires exact current integration, policy, and role coordinates. Older-policy pending records are retained but cannot block current work or acquire the current policy's meaning.

History reconciliation recovers messages that reached Discord while the Node process was unavailable. Durable inbox retry recovers messages already normalized and correlated before processing failed. Neither mechanism substitutes for the other.

Provider-backed writing evaluation uses provider adapters' JSON-schema output boundary before validating the exact evaluation response contract. Invalid or unavailable evaluation stays fail-closed and retryable. `interaction_retry_failed` means the worker could not safely inspect or advance its durable inbox: the Node marks conversation health unavailable and exits through its existing supervised failure path. The health code contains no message or provider output.

The read responder persists a bounded request-digest-to-CAS-artifact coordinate after managed-run and independent-session validation but before publication evaluation. Evaluator-only retry reuses that artifact across process restart. A definitive writing-policy rejection removes it so regeneration remains possible. Cache state never bypasses publication evaluation or its separate provider boundary.

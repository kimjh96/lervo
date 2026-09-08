# Conversation transport and recovery

## Gateway control

Discord Gateway control frames and application dispatch use separate ordered queues. Sequence, heartbeat acknowledgement, reconnect, and resume handling never wait for intent resolution or provider execution. Authenticated application dispatch stays ordered and retains its bounded session proof across reconnect. A long response therefore cannot create a false missed-heartbeat window that discards a following message.

Gateway resume coordinates intentionally remain process-local. On READY or RESUMED, a Discord REST history adapter reads after the platform SQLite channel cursor before readiness is published. A conversation-owned ingress processor orders recovered messages, reuses normal adapter and interaction handling, and advances the cursor with compare-and-set only after processing. First installation records a current baseline instead of importing prior channel history; existing databases seed from their newest Discord correlation. A 1,000-message startup bound fails closed rather than hiding an unbounded gap.

## Typing indicator

After participation policy chooses `respond`, the Discord adapter starts a transient typing lease, refreshing every eight seconds within Discord's ten-second expiry. Response completion, retry scheduling, or publication failure stops refresh.

Ignored, duplicate, busy, rate-limited, and other observe-only inputs do not start typing. `platform_activity_failed` means the best-effort indicator could not be sent; it creates no receipt or durable state and cannot change the response outcome.

## Response recovery

Accepted interactions are persisted before provider work. Generation or publication failure returns the inbox record to a time-bounded pending state. A conversation-owned retry loop processes one ready record at a time without another Discord message, independently of Gateway control traffic, and recovers expired leases after process interruption. Selection requires exact current integration, policy, and role coordinates. Older-policy pending records are retained but cannot block current work or acquire the current policy's meaning.

History reconciliation recovers messages that reached Discord while the Node process was unavailable. Durable inbox retry recovers messages already normalized and correlated before processing failed. Neither mechanism substitutes for the other.

Provider-backed writing evaluation uses provider adapters' JSON-schema output boundary before validating the exact evaluation response contract. Invalid or unavailable evaluation stays fail-closed and retryable. `interaction_retry_failed` means the worker could not safely inspect or advance its durable inbox: the Node marks conversation health unavailable and exits through its existing supervised failure path. The health code contains no message or provider output.

The read responder persists a bounded request-digest-to-CAS-artifact coordinate after managed-run and independent-session validation but before publication evaluation. Evaluator-only retry reuses that artifact across process restart. A definitive writing-policy rejection removes it so regeneration remains possible. Cache state never bypasses publication evaluation or its separate provider boundary.

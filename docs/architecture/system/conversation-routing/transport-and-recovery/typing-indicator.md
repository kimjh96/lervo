# Typing indicator

After participation policy chooses `respond`, the Discord adapter starts a transient typing lease and refreshes it every eight seconds within Discord's ten-second expiry. Conversation composition retains the lease through a scheduled response retry. Completion, terminal failure, abort, or the five-minute safety timeout stops refresh.

Ignored, duplicate, busy, rate-limited, and other observe-only inputs do not start typing. `platform_activity_failed` means the best-effort indicator could not be sent; it creates no receipt or durable state and cannot change the response outcome.

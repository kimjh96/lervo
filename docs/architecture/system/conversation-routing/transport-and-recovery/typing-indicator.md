# Typing indicator

After participation policy chooses `respond`, the Discord adapter starts a transient typing lease, refreshing every eight seconds within Discord's ten-second expiry. Response completion, retry scheduling, or publication failure stops refresh.

Ignored, duplicate, busy, rate-limited, and other observe-only inputs do not start typing. `platform_activity_failed` means the best-effort indicator could not be sent; it creates no receipt or durable state and cannot change the response outcome.

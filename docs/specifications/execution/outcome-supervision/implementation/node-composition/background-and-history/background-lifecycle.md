# Background lifecycle and recovery

The composed runtime exposes explicit background `start` through the existing serial change loop and local committed-head watcher. Direct API use does not automatically activate production operation. Explicit [installed startup configuration](../installed-startup.md) connects the same loop to Node start and shutdown. Repeated starts do not install another loop.

Hints during work coalesce; deadlines interrupt idle waiting. A 30-second reconciliation check covers missed notifications. Failures retain a five-second delay. Overdue work starts at five seconds and backs off to 300 seconds while cycles leave the source unchanged; a hint or change resets the backoff ([event history cursors](event-history-cursors.md)).

The first cycle reconstructs work and pending effects through existing durable ports. Later null idle reports retain the previously observed responsibility deadline. The next check also includes future mandate expiry and the authority history audit. Timers own no durable task state and do not authorize effects.

Closing removes subscriptions and timers, waits for the active cycle, then closes owner storage. Restart tests recover the recorded effect without executing it again.

<!-- lervo-release package="@lervo/cli" version="0.25.1" schema="1" -->

## What's changed

- Stop lervo upgrade --apply with knowledge_cycle_admission_lost when a stalled event loop let its full-cycle admission lapse to a background knowledge cycle, hold a 2-hour upgrade lease, and run the launchd host follower at standard priority.

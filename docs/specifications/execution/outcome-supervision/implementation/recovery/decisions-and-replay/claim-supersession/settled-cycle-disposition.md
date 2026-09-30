# Settled-cycle disposition

The runtime skips a cycle whose source is unchanged since the last settled cycle until its next check. A skipped cycle repeats the settled disposition.

A source that was `blocked`, for example by `owner_plan_unavailable`, stays `blocked` and retains its attention health. Previously, it read as `idle`, and Node health reported `ready` while the owner could not act. On 2026-09-24, this hid Kael's exhausted owner-spend epoch.

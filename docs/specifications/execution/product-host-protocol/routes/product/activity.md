# Product activity

`product_activity.inspect` (v8), exposed by `application activity --json`, returns `ProductActivityPageV1` from a verified canonical event-chain head and an exact repository revision.

The route accepts an optional opaque cursor and a limit from 1 through 100. It opens repository storage read-only, scans cursor identity with bounded memory, and projects at most `limit + 1` events.

Results contain classifications and opaque evidence coordinates, never event payload bodies. A cursor absent from the verified chain returns `activity_cursor_stale`. Invalid evidence and unsupported event schemas remain distinct failures.

The route grants no write, approval, provider, delivery, or lifecycle authority.

Discord and future first-party surfaces consume this contract. Rendering, polling, and transport-specific subscriptions remain outside the route and may not reinterpret a failed page as empty success.

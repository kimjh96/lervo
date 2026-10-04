# Authenticated webhooks

An owner-authorized signed webhook can materialize a fixed assignment routine with `lervo trigger webhook serve --config <config.json>`. The listener is loopback-only; external payloads never become assignment instructions, and provider execution remains separate.

See [authenticated live triggers](../../../../docs/specifications/execution/authority-and-repository/authenticated-live-triggers.md).

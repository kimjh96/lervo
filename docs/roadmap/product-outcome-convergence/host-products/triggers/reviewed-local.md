# Reviewed local triggers

State: `implemented`.

Outcome: reviewed local input safely triggers repeatable assignment and handoff work.

Exact assignment routines materialize from one manual trigger. A separate reviewed-input direct-message adapter routes one content-addressed message into an existing handoff through exact plan/apply and source-event idempotency.

Preserve the packed local trigger-to-handoff-to-acknowledgment journey and its no-live-platform and no-provider-start boundaries.

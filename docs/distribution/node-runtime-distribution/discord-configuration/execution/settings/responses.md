# Response limits and providers

`maxResponseAttempts` accepts 1 through 10 and defaults to 3. It bounds response generation and publication attempts. Discord REST delivery attempts retain their separate durable outbox policy.

`routing.response.timeoutMs` accepts 1,000 through 300,000 milliseconds and defaults to 60,000. It bounds the combined managed conversation provider turn and its adapter requests. Timeout failure enters the same bounded retry and visible terminal-failure path.

`routing.intent` is optional and retained only for backward-compatible custom responder composition. The installed managed path uses `routing.response` for intent, participation, effect, and reply in one run.

Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment. Automation depth and hourly response limits remain mandatory loop controls.

The managed provider host accepts optional provider-keyed `models` and `reasoningEfforts` beside `executables`. These adapter inputs do not expand provider or role allowlists.

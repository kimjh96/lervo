# Response limits and providers

## Limits and routing

`maxResponseAttempts` accepts 1 through 10, defaults to 3, and bounds response generation and publication attempts. Discord REST delivery attempts retain their separate durable outbox policy.

`routing.response.timeoutMs` accepts 1,000 through 300,000 milliseconds, defaults to 60,000, and bounds the combined managed conversation provider turn and its adapter requests. Timeout failure enters the same bounded retry and visible terminal-failure path.

`routing.intent` is optional and retained only for backward-compatible custom responder composition. The installed managed path uses `routing.response` for intent, participation, effect, and reply in one run.

Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment. Automation depth and hourly response limits remain mandatory loop controls.

## Provider settings and native work

The managed provider host accepts optional provider-keyed `models` and `reasoningEfforts` beside `executables`. These adapter inputs do not expand provider or role allowlists.

Native repository work may additionally use the semantic `executionProfiles` policy documented under [provider execution and continuity](../native-work/provider-execution.md). Conversation answering still uses `routing.response`; profile selection applies only after the managed turn admits `repository_work`.

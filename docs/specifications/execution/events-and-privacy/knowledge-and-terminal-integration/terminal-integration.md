# Terminal integration and activation receipts

`terminal.integration.applied` records the contract, providers, provider-target path digests and after-hashes, generated-runtime path digest and after-hash, approval hash, and time. It excludes prompts, bodies, raw configuration, commands, runtime bytes, credentials, absolute paths, and output. Failure rolls back and emits no success event.

Bounded provider and event activation receipts contain provider, event, result, time, and bounded hashes and counts. They prove only that the Lervo hook endpoint executed or prepared context—not that the provider launched, accepted, understood, referenced, or used it. Status labels this evidence `hook_endpoint_observed_not_provider_authorship`.

Receipt failure blocks the hook. Status validates receipts against events, distinguishes endpoint observation from readiness, and emits a provider-specific action until every required event is observed. Lervo never changes local or global hook trust.

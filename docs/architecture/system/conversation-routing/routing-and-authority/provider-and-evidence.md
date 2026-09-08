# Provider and evidence design

Intent, read response, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model and reasoning choices remain adapter configuration.

Immutable intent evidence binds event ID, message hash, provider, model, adapter version, structured effect, result digest, and resolution time without copying raw message text. A bounded platform action argument may repeat the requested nickname but never includes the full message. After restart, retries read and verify that exact resolution without invoking the classifier again or rewriting immutable evidence.

Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content to preserve local context across restart.

Managed read responses retain context selection and injection, CAS, run events, provider-session identity, deterministic writing evidence, and provider token and cache telemetry. Omitting `routing.evaluation` selects the realtime deterministic publication profile; configuring it adds the independent semantic model pass.

Repository continuation retains managed-host workstream advancement and knowledge-current completion checks. Platform administration deliberately does not invoke repository finalization.

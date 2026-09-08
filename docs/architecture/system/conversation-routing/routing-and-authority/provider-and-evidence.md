# Provider and evidence design

Intent, read response, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model and reasoning choices remain adapter configuration.

Immutable intent evidence binds event ID, message hash, provider, model, adapter version, result digest, and resolution time without copying raw message text. After restart, retries read and verify that exact resolution without invoking the classifier again or rewriting immutable evidence. Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content to preserve local context across restart.

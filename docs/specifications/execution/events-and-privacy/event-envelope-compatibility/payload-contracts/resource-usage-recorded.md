# `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode and descriptor hash, status, bounded counters, and reason code. Counts are non-negative. Cached input cannot exceed input, reasoning output cannot exceed output, and total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Provider identity and native counter semantics remain in a canonical local CAS descriptor, not this event. Descriptor-storage failure creates no dangling resource observation.

Historical version 2 `adapter.result.captured` and `resource.usage.recorded` events created before provider-model evidence was added may omit `modelIdentity`. Sync accepts only those two exact legacy shapes after all other current payload-field, privacy-allowlist, envelope, and hash checks succeed. It preserves the original payload and hash without fabricating model evidence; consumers treat absent identity as unavailable. Current producers require an explicit observed or unavailable `modelIdentity` value.

Governed resource accounting and work reports also read the exact historical version 2 resource shape. They preserve observed counters and unavailable usage without adding model identity to the payload. Current version 3 omissions, explicit null or malformed identities, unknown fields, and contradictory counters remain invalid. Missing adapter-start or causal evidence remains an independent failure; historical shape compatibility cannot supply it.

## Attribution and measured channels

[ADR-0459](../../../../../decisions/execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) adds five optional attribution fields that a writer records together or not at all: `agentId` (a workforce agent identifier or null), `conversationDigest` (a SHA-256 digest of the conversation and thread identifiers, or null outside a conversation), `channel` (`terminal`, `managed_run`, `conversation`, `supervision`, `knowledge_worker`, or `deliberation`), `turnEventId` (the turn's source event identifier), and `stage` (a bounded reason-code-shaped stage name). `source` gains `estimated`, which reports never present as provider-billed. Readers tolerate historical events without attribution.

Discord repository-work turns record `channel: conversation` and `stage: repository_work_turn` under the turn's conversation run, with provider counters normalized by the repository-work adapter. Knowledge workers record `channel: knowledge_worker`, the stage task as `stage`, and the usage already retained in the stage observation artifact. Both channels also record a context receipt in the same run: one `context.selected` event with `origin: managed_turn` and one `document.loaded` event for each document Lervo selected and read. These channels claim no `context.injected` or `context.referenced` state, because no adapter receipt proves injection or use.

A provider that reports no counters still produces a record with `status: unavailable` and `reasonCode: provider_usage_unreported`. A failed repository-work retrieval yields an empty receipt and a turn without document pointers; retrieval quality is not a measurement failure. When the receipt or the usage record cannot be produced or stored, the turn fails its completion gate with `measurement_unavailable`; a repository-work turn then publishes no completion, and a knowledge stage records the failure code. Retries reuse deterministic event identities, so one turn never counts usage twice.

Privacy: attribution carries identifiers, digests, counts, and stage names only. Conversation and thread identifiers, query text, prompts, outputs, and document bytes stay out of these events.

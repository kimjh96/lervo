# `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode, descriptor hash, status, bounded counters, and reason code. Counts are non-negative. Cached input cannot exceed input; reasoning output cannot exceed output; total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Native counter semantics remain in a canonical local CAS descriptor, never this event; the event names only the provider and the observed model. Descriptor-storage failure creates no dangling resource observation.

Historical version 2 `adapter.result.captured` and `resource.usage.recorded` events created before provider-model evidence was added may omit `modelIdentity`. Sync accepts only those two exact legacy shapes after all other current payload-field, privacy-allowlist, envelope, and hash checks pass. It preserves the original payload and hash without fabricating model evidence; consumers treat absent identity as unavailable. Current producers require explicit observed or unavailable `modelIdentity`.

Governed resource accounting and work reports also read the exact historical version 2 resource shape, preserving observed counters and unavailable usage without adding model identity to the payload. Current version 3 omissions, explicit null or malformed identities, unknown fields, and contradictory counters remain invalid. Missing adapter-start or causal evidence remains an independent failure; historical compatibility cannot supply it.

## Attribution and measured channels

[ADR-0459](../../../../../decisions/execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) adds five optional attribution fields, recorded together or not at all:

- `agentId`: workforce agent identifier or null.
- `conversationDigest`: SHA-256 digest of conversation and thread identifiers, or null outside a conversation.
- `channel`: `terminal`, `managed_run`, `conversation`, `supervision`, `knowledge_worker`, or `deliberation`.
- `turnEventId`: the turn's source event identifier.
- `stage`: bounded reason-code-shaped stage name.

`source` gains `estimated`, which reports never present as provider-billed. Readers tolerate historical events without attribution.

Discord repository-work turns record `channel: conversation` and `stage: repository_work_turn` under the turn's conversation run, with provider counters normalized by the repository-work adapter. Knowledge workers record `channel: knowledge_worker`, the stage task as `stage`, and usage already retained in the stage observation artifact.

Both channels record a context receipt in the same run: one `context.selected` event with `origin: managed_turn` and one `document.loaded` event per document Lervo selected and read. They claim no `context.injected` or `context.referenced` state because no adapter receipt proves injection or use.

A provider reporting no counters still produces a record with `status: unavailable` and `reasonCode: provider_usage_unreported`. Failed repository-work retrieval yields an empty receipt and a turn without document pointers; retrieval quality is not a measurement failure.

If the receipt or usage record cannot be produced or stored, the turn fails its completion gate with `measurement_unavailable`: a repository-work turn publishes no completion, and a knowledge stage records the failure code. Retries reuse deterministic event identities so one turn never counts usage twice.

Attribution carries only identifiers, digests, counts, and stage names. Conversation and thread identifiers, query text, prompts, outputs, and document bytes stay out of these events.

## Hosted sessions (schema 11)

[ADR-0632](../../../../../decisions/execution/applications/0632-build-the-ade-as-the-platform-where-the-core-works.md) records the usage of hosted ADE sessions in this event, so Lervo keeps one usage ledger with one token vocabulary. A hosted session has no managed work: no work causality root, mandate, or agent turn caused it. Its records therefore carry a different attribution:

- `workId` is null, and `hostedSession` holds `providerSessionDigest` and `provider`. The session appears only as that digest.
- The five managed attribution fields are absent.
- `source` is `provider_reported`, and `status` is `observed` or `partial`: a result that reported no usage records nothing. `cacheCreationInputTokens`, `costUsd`, and `costBasis` are required.
- `modelIdentity` may keep a bracketed tier in the model name, such as `claude-opus-5-5[1m]`, because that tier is priced differently. A name that is still invalid uses the unavailable identity with `unavailableReason: model_name_invalid`.

A managed record keeps a work ID, never names a hosted session, and keeps the managed model name pattern. It carries none of the three new fields yet, because managed readers parse versions 2 and 3 only. A managed writer can report cost only after those readers accept schema 11 and select records by attribution.

The new fields keep the shared meanings:

- `cacheCreationInputTokens` is part of `usage.inputTokens`, as `usage.cachedInputTokens` (cache reads) is. The two together cannot exceed the input.
- `costUsd` is the provider's list-price estimate with `costBasis: list`, or null with `costBasis: unreported`. Writing one requires the other.
- A provider that reports no reasoning count records 0 with `status: partial` and `reasonCode: reasoning_unreported`, never an `observed` 0.

The payload schema ignores the envelope version, so the event envelope enforces the version boundary. Below schema 11, a `resource.usage.recorded` envelope requires a work ID and refuses `hostedSession` and the three new fields. Older readers therefore never receive a record they would reject. Readers of managed usage, such as governed accounting, supervision spend, and work reports, read versions 2 and 3 only, so hosted records never count as mandate or agent spend. No reader reports total usage yet. One that does must read versions 2, 3, and 11, and select hosted records by `hostedSession`.

Requirements for the hosted writer (ADR-0632 S2b):

- Like a managed writer, it must store its accounting descriptor in the local artifact store before it records the first usage that names it.
- One record covers one provider result and one model.
- Its observation identity must derive from the session digest, the provider's result identifier, and the model, so a replayed stream records each result once.

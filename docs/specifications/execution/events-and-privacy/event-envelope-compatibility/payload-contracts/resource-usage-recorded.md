# `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode and descriptor hash, status, bounded counters, and reason code. Counts are non-negative. Cached input cannot exceed input, reasoning output cannot exceed output, and total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Provider identity and native counter semantics remain in a canonical local CAS descriptor, not this event. Descriptor-storage failure creates no dangling resource observation.

Historical version 2 `adapter.result.captured` and `resource.usage.recorded` events created before provider-model evidence was added may omit `modelIdentity`. Sync accepts only those two exact legacy shapes after all other current payload-field, privacy-allowlist, envelope, and hash checks succeed. It preserves the original payload and hash without fabricating model evidence; consumers treat absent identity as unavailable. Current producers require an explicit observed or unavailable `modelIdentity` value.

Governed resource accounting and work reports also read the exact historical version 2 resource shape. They preserve observed counters and unavailable usage without adding model identity to the payload. Current version 3 omissions, explicit null or malformed identities, unknown fields, and contradictory counters remain invalid. Missing adapter-start or causal evidence remains an independent failure; historical shape compatibility cannot supply it.

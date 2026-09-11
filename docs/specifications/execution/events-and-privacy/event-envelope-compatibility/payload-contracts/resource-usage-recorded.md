# `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode and descriptor hash, status, bounded counters, and reason code. Counts are non-negative; cached input cannot exceed input, reasoning output cannot exceed output, and total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Provider identity and native counter semantics remain in a canonical local CAS descriptor, not this event. Descriptor-storage failure creates no dangling resource observation.

Historical version 2 `adapter.result.captured` and `resource.usage.recorded` events created before provider-model evidence was added can omit `modelIdentity`. Sync accepts only those two exact legacy shapes after every other current payload field, privacy allowlist, envelope, and hash check succeeds. It preserves the original payload and hash without fabricating model evidence; consumers treat absent identity as unavailable. Current producers require an explicit observed or unavailable `modelIdentity` value.

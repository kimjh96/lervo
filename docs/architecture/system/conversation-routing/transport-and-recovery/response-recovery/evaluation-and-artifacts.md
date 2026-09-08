# Evaluation and artifact reuse

Provider-backed writing evaluation uses provider adapters' JSON-schema output boundary before validating the exact evaluation response contract. Invalid or unavailable evaluation stays fail-closed and retryable.

The read responder persists a bounded request-digest-to-CAS-artifact coordinate after managed-run and independent-session validation but before publication evaluation. The digest binds stable semantic participation fields rather than a per-attempt decision ID. A process-local single-flight prevents concurrent identical generation.

Evaluator-only retry reuses that artifact across process restart. A definitive writing-policy rejection removes it so regeneration remains possible. Cache state never bypasses publication evaluation or its separate provider boundary.

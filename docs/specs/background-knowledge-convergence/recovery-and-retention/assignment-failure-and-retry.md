# Assignment failure and retry

A stopped stage failure stores a private CAS receipt binding the exact assignment contract, input, lease ID and generation, normalized code, upstream evidence hash, and return time. Returning that exact lease records a failed assignment; it never accepts provider output or grants another write. Revocation permits failure bookkeeping but denies new document effects. Lost or expired authority cannot be silently replaced.

Retry requires the exact canonical failed completion and private artifact, current source and delegation, and a resolved stopped dependency. It reopens the same assignment with predecessor contract and responsibility hashes, terminal event ID, and increasing lease generation. The hard bound remains sixteen attempts.

Provider reservations survive retries. Semantic stages permit at most three calls per stage batch within the delegation ceiling; normalization generation and review retain their shared eight-call bound. An unknown native reset still requires an exact successful availability probe.

A document normalizer process that reports the typed `timed_out` status retries as a transient stage failure under the existing backoff and attempt ceiling. Its provider reservation remains in the same batch; other `knowledge_compile_failed` outcomes still require attention.

Generator and reviewer identities retain the existing parent's read responsibility. New source roots may enter later baselines without widening parent authority or writer paths. Writer and integrator assignments remain limited to approved target paths. A legacy narrow reader may be replaced once by a stable identity bound to the existing parent responsibility, without new write authority.
